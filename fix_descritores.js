let indexer = require("./indexer");
let client = indexer._client;

client.search({
    index: indexer.mapping.index,
    query: {
        wildcard: {
            "Descritores.keyword": "*\n*"
        }
    },
    scroll: '30s',
    _source: ["Descritores"]
}).then( async (res) => {
    while(res.hits.hits.length){
        for(let hit of res.hits.hits){
            await client.update({
                id: hit._id,
                index: indexer.mapping.index,
                doc: {
                    Descritores: hit._source.Descritores.join(" ").split("\n")
                }
            })
        }
        res = await client.scroll({
            scroll_id: res._scroll_id,
            scroll: '30s'
        });
    }
})