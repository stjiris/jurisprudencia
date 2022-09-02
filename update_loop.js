const { Client } = require('@elastic/elasticsearch');
const client = new Client({ node: 'http://localhost:9200' });
const jsdom = require("jsdom")


client.search({
    index: "jurisprudencia.5.0",
    query: {
        bool: {
            must_not: {
                exists: {
                    field: "Meio Processual"
                }
            }
        }
    },
    scroll: "1m"
}).then( async res => {
    while( res.hits.hits.length > 0 ){
        for( let hit of res.hits.hits ){
            await client.update({
                index: "jurisprudencia.5.0",
                id: hit._id,
                doc: {
                    "Meio Processual": new jsdom.JSDOM(hit._source.Original["Meio Processual"]).window.document.body.textContent.trim()
                }
            })
            console.log("Updated", hit._source.UUID)
        }
        res = await client.scroll({
            scroll_id: res._scroll_id,
            scroll: "1m"
        })
    }
})