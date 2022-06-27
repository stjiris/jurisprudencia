const { Client } = require("@elastic/elasticsearch");
const client = new Client({
    node: "http://localhost:9200"
});
const {Router} = require("express")
const {scroll, mapping} = require("../indexer");

const app = Router();
module.exports = app;

const NO_SECTION_QUERY = {
    bool: {
        must_not: [
            {exists: {
                field: "Secção"
            }},
            {wildcard: {
                "Nº Convencional": {
                    value: "*secção*",
                    case_insensitive: true
                }
            }}
        ]
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
        index: mapping.index,
        size: 1,
        query: NO_SECTION_QUERY
    })) {
        found = false;
        if( !_source["Nº Convencional"].match(/Secção/i) ){
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
        }
        if( found && !sent[`${found.key} - ${found.value} - ${found.Tribunal}`] ) {
            sent[`${found.key} - ${found.value} - ${found.Tribunal}`] = true;
            res.write(`event: SeccaoFound\n`);
            res.write(`data: ${JSON.stringify(found)}\n\n`);
        }
    }

    res.write(`event: EndEvent\ndata:\n\n`);
})

