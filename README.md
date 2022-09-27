# Indexing

If the index does not exist run `node jurisprudencia.js` to create it.

To populate/update the index run `node jurispudencia-indexer.js`. This will generate an `indexer-report-*.json` file with the report of the populate/update.

## Environment Variables
 - `ES_URL`: Elasticsearch url, defaults to `http://localhost:9200`

## TODO:
 - Create parameters to make a soft/full update. Currently it will always perform a full update.
 - Import 800 processos from a different database