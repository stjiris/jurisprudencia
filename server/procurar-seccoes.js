const { Client } = require("@elastic/elasticsearch");
const client = new Client({
    node: "http://localhost:9200"
});
const {Router} = require("express")
const {scroll} = require("../indexer");
const INDEX = 'jurisprudencia.1.0';
const ECLI = require("../util/ecli");

const app = Router();
module.exports = app;

const NO_SECTION_QUERY = {
    bool: {
        must_not: {
            exists: {
                field: "Secção"
            }
        }
    }
}

app.get("/", async (req, res) => {
    res.set({
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive'
    });
    res.flushHeaders();

    let sent = {};

    for await (const {_source} of scroll({
        index: INDEX,
        size: 1,
        query: NO_SECTION_QUERY
    })) {
        found = false;
        for( let key in _source ) {
            if( !key.match(/(Texto|Aditamento|Sumário)/) && _source[key].match && _source[key].match(/Secção/i) ){
                found = {
                    key: key,
                    value: _source[key],
                    Tribunal: _source.Tribunal,
                }
                break;
            }
        }
        if( found && !sent[`${found.key} - ${found.value} - ${found.Tribunal}`] ) {
            sent[`${found.key} - ${found.value} - ${found.Tribunal}`] = true;
            res.write(`event: SeccaoFound\n`);
            res.write(`data: ${JSON.stringify(found)}\n\n`);
        }
    }

    res.write(`event: EndEvent\ndata:\n\n`);
})

