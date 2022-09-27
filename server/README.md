# Running the server

Command line: `$ node server.js`
Optional environment variables:
 - `PORT`: Server port, defaults to `9100`
 - `ES_URL`: Elasticsearch url, defaults to `http://localhost:9200`

It assumes that the elasticsearch instance is running on the specified `ES_URL`.
It also assumes that the elasticsearch instance was populated by `../jurisprudencia-indexer.js`.