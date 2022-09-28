const {Client} = require("@elastic/elasticsearch");
const client = new Client({ node: process.env.ES_URL || 'http://localhost:9200' });
const jsdom = require("jsdom");
const fs = require("fs");

let objs = [];
client.search({
    index: 'jurisprudencia.6.0',
    scroll: '2m',
    _source: ["UUID", "Relator", "Texto"]
}).then( async r => {
    let writer = fs.createWriteStream('relatores.tsv');
    writer.write(`"UUID"\t"Campo Relator"\t"Indíce no Texto"\t"Tamanho do Texto"\t"Forma no texto"\t"Linha Relator"\r\n`)
    while( r.hits.hits.length > 0 ){
        for( let hit of r.hits.hits ){
            if( !hit._source.Texto ){
                writer.write(`"${hit._source.UUID}"\t"${hit._source.Relator}"\t\t\t\t\r\n`)
                continue;
            }
            let texto = new jsdom.JSDOM(hit._source.Texto).window.document.body.textContent.trim();
            let relator = hit._source.Relator;
            let exactM = texto.match(new RegExp(relator, 'i'));
            let relatLine = texto.match(/^(.*)\(Relator\)/mi);
            let relatLineName = relatLine ? relatLine[1].trim() : ""
            if( !exactM ){
                writer.write(`"${hit._source.UUID}"\t"${hit._source.Relator}"\t-1\t${texto.length}\t""\t"${relatLineName}"\r\n`)
            }
            else{
                writer.write(`"${hit._source.UUID}"\t"${hit._source.Relator}"\t${exactM.index}\t${texto.length}\t"${exactM}"\t"${relatLineName}"\r\n`)

            }
        }
        r = await client.scroll({
            scroll: '2m',
            scroll_id: r._scroll_id
        });
    }
})
