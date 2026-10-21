# ETL Implementation (JavaScript)

A starter CSV ETL dashboard using Node.js, Express, SQLite, and plain HTML/CSS/JavaScript.

## Requirements
- Node.js 20 or newer (Node.js 22 LTS recommended)
- npm (installed with Node.js)

## Install and run on Windows with VS Code
1. Extract this ZIP to a folder such as `C:\Projects\etl_implementation_js`.
2. Open that folder in VS Code (`File` → `Open Folder`).
3. Choose `Terminal` → `New Terminal`.
4. Confirm the terminal is in the project directory, then run:

   ```powershell
   npm install
   npm start
   ```

5. Open `http://localhost:3000` for the dashboard. Visit `http://localhost:3000/health` to check the server.
6. Stop the server with `Ctrl+C` in the terminal.

If PowerShell says `npm` is not recognized, close and reopen VS Code after installing Node.js, then run `node -v` and `npm -v`.

## Test
Run in the project directory:

```powershell
npm test
```

## Try a CSV
Create `sample.csv`:

```csv
product_code,product_name,price
P001,Keyboard,250
P002,Mouse,invalid
P003,Laptop,4500
```

Upload it on the dashboard. The file imports three rows; blank rows/fields are initially marked failed. Click **Process** on pending rows: the keyboard and laptop should pass the example rules; the mouse should fail because its price is not a positive number. Use **Retry** to return a failed row to pending, then process it again. Retries are limited to three.

## API endpoints
- `POST /api/uploads` — upload CSV using multipart field `file`
- `GET /api/uploads` — list batches
- `GET /api/uploads/:batchId` — batch and records
- `GET /api/summary` — dashboard counts
- `GET /api/records?status=pending&page=1&limit=20` — filter and paginate records
- `GET /api/records/:recordId` — get one record
- `POST /api/records/:recordId/process` — validate/process a record
- `POST /api/records/:recordId/retry` — retry a failed record
- `GET /health` — health check

## Database design
The SQLite file `etl.db` is created automatically in the project root.

1. `uploads`: batch ID, filename, SHA-256 hash, counts, status, error message, timestamps.
2. `etl_records`: record ID, batch ID, source row number, JSON data, status, processing timestamp, failure reason, retry count, timestamps.

## Important customization notes
The validation rules are examples: all CSV fields must be nonblank, and a field named `price`, if present, must be numeric and greater than zero. Replace `validateRecord` in `src/etl.js` with your actual data rules. The current app stores and validates records locally; it does not yet connect to a third-party destination system or run a background worker. For production, add authentication, authorization, structured logging, background processing, and stronger duplicate/transaction handling as needed.
