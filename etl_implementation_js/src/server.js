const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const crypto = require('node:crypto');
const path = require('node:path');
const db = require('./db');
const { validateRecord } = require('./etl');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_RETRIES = 3;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_SIZE, files: 1 } });
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const getBatch = db.prepare('SELECT * FROM uploads WHERE id = ?');
const getRecord = db.prepare('SELECT * FROM etl_records WHERE id = ?');
function parseRecord(row) { return { ...row, data: JSON.parse(row.data_json) }; }
function refreshBatch(batchId) {
  const counts = db.prepare(`SELECT COUNT(*) total, SUM(status='success') successes, SUM(status='failed') failures,
    SUM(status='pending') pending, SUM(status='processing') processing FROM etl_records WHERE batch_id=?`).get(batchId);
  const status = counts.pending || counts.processing ? (counts.successes || counts.failures ? 'processing' : 'pending')
    : counts.failures ? ((counts.successes || 0) ? 'completed_with_errors' : 'failed') : 'completed';
  db.prepare(`UPDATE uploads SET total_records=?, success_count=?, failure_count=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(counts.total || 0, counts.successes || 0, counts.failures || 0, status, batchId);
}

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/summary', (_req, res) => {
  const uploads = db.prepare('SELECT COUNT(*) count FROM uploads').get().count;
  const records = db.prepare(`SELECT COUNT(*) total, SUM(status='pending') pending, SUM(status='success') success,
    SUM(status='failed') failed FROM etl_records`).get();
  res.json({ uploads, records: { total: records.total || 0, pending: records.pending || 0, success: records.success || 0, failed: records.failed || 0 } });
});

app.post('/api/uploads', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a CSV file to upload.' });
  if (!req.file.originalname.toLowerCase().endsWith('.csv')) return res.status(400).json({ error: 'Only .csv files are accepted.' });
  const content = req.file.buffer.toString('utf8').replace(/^\uFEFF/, '');
  if (!content.trim()) return res.status(400).json({ error: 'The CSV file is empty.' });
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex');
  if (db.prepare('SELECT id FROM uploads WHERE file_hash=?').get(fileHash)) return res.status(409).json({ error: 'This exact file has already been uploaded.' });
  let rows;
  try { rows = parse(content, { columns: true, skip_empty_lines: true, bom: true, trim: true, relax_column_count: false }); }
  catch (error) { return res.status(400).json({ error: `CSV parsing failed: ${error.message}` }); }
  if (!rows.length) return res.status(400).json({ error: 'The CSV contains a header but no data rows.' });
  const headers = Object.keys(rows[0]);
  if (!headers.length || headers.some(h => !h.trim())) return res.status(400).json({ error: 'CSV headers must not be blank.' });
  if (new Set(headers).size !== headers.length) return res.status(400).json({ error: 'CSV headers must be unique.' });
  const batchId = crypto.randomUUID();
  const insertBatch = db.prepare('INSERT INTO uploads (id, filename, file_hash, total_records, status) VALUES (?, ?, ?, ?, ?)');
  const insertRecord = db.prepare('INSERT INTO etl_records (id, batch_id, row_number, data_json, status, failure_reason) VALUES (?, ?, ?, ?, ?, ?)');
  const transaction = db.transaction(() => {
    insertBatch.run(batchId, req.file.originalname, fileHash, rows.length, 'pending');
    rows.forEach((row, index) => {
      const empty = Object.values(row).some(v => String(v ?? '').trim() === '');
      insertRecord.run(crypto.randomUUID(), batchId, index + 2, JSON.stringify(row), empty ? 'failed' : 'pending', empty ? 'One or more fields are blank.' : null);
    });
  });
  try { transaction(); refreshBatch(batchId); }
  catch (error) { return res.status(500).json({ error: `Could not save upload: ${error.message}` }); }
  res.status(201).json({ message: 'CSV uploaded.', batch: getBatch.get(batchId) });
});

app.get('/api/uploads', (_req, res) => res.json(db.prepare('SELECT * FROM uploads ORDER BY created_at DESC').all()));
app.get('/api/uploads/:batchId', (req, res) => {
  const batch = getBatch.get(req.params.batchId);
  if (!batch) return res.status(404).json({ error: 'Upload batch not found.' });
  const records = db.prepare('SELECT * FROM etl_records WHERE batch_id=? ORDER BY row_number').all(batch.id).map(parseRecord);
  res.json({ batch, records });
});
app.get('/api/records', (req, res) => {
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit || '20', 10)));
  const status = req.query.status;
  const batchId = req.query.batch_id;
  const allowed = ['pending', 'success', 'failed'];
  if (status && !allowed.includes(status)) return res.status(400).json({ error: 'status must be pending, success, or failed.' });
  const conditions = [], params = [];
  if (status) { conditions.push('status=?'); params.push(status); }
  if (batchId) { conditions.push('batch_id=?'); params.push(batchId); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) count FROM etl_records ${where}`).get(...params).count;
  const records = db.prepare(`SELECT * FROM etl_records ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, (page - 1) * limit).map(parseRecord);
  res.json({ records, page, limit, total, pages: Math.ceil(total / limit) });
});
app.get('/api/records/:recordId', (req, res) => {
  const record = getRecord.get(req.params.recordId);
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  res.json(parseRecord(record));
});
app.post('/api/records/:recordId/process', (req, res) => {
  const record = getRecord.get(req.params.recordId);
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  if (record.status === 'success') return res.status(409).json({ error: 'Record has already succeeded.' });
  const errors = validateRecord(JSON.parse(record.data_json));
  const status = errors.length ? 'failed' : 'success';
  db.prepare(`UPDATE etl_records SET status=?, failure_reason=?, processed_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
    .run(status, errors.length ? errors.join('; ') : null, record.id);
  refreshBatch(record.batch_id);
  res.json(parseRecord(getRecord.get(record.id)));
});
app.post('/api/records/:recordId/retry', (req, res) => {
  const record = getRecord.get(req.params.recordId);
  if (!record) return res.status(404).json({ error: 'Record not found.' });
  if (record.status !== 'failed') return res.status(409).json({ error: 'Only failed records can be retried.' });
  if (record.retry_count >= MAX_RETRIES) return res.status(409).json({ error: `Maximum of ${MAX_RETRIES} retries reached.` });
  db.prepare(`UPDATE etl_records SET status='pending', failure_reason=NULL, retry_count=retry_count+1, processed_at=NULL, updated_at=datetime('now') WHERE id=?`).run(record.id);
  refreshBatch(record.batch_id);
  res.json(parseRecord(getRecord.get(record.id)));
});

app.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Maximum upload size is 5 MiB.' });
  res.status(500).json({ error: 'Unexpected server error.' });
});
if (require.main === module) app.listen(PORT, () => console.log(`ETL app running at http://localhost:${PORT}`));
module.exports = { app, validateRecord };
