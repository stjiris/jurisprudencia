const {Client} = require("@elastic/elasticsearch");
const client = new Client({ node: process.env.ES_URL || "http://localhost:9200" });
const jsdom = require("jsdom");
const fs = require("fs/promises");

let objs = [];
client.search({
    index: 'jurisprudencia.6.0',
    scroll: '2m',
    _source: ["UUID", "Original"]
}).then( async r => {
    while( r.hits.hits.length > 0 ){
        for( let hit of r.hits.hits ){
            let original = hit._source.Original;
            delete original["Sumário"];
            delete original["Decisão Texto Integral"];
            Object.keys(original).forEach( k => {
                original[k] = new jsdom.JSDOM(original[k]).window.document.body.textContent.trim();
            })
            original.UUID = hit._source.UUID;
            objs.push(original);
        }
        r = await client.scroll({
            scroll: '2m',
            scroll_id: r._scroll_id
        });
    }
}).then( () => {
    console.log("Writing JSON.");
    fs.writeFile("processos.json", JSON.stringify(objs));
})
