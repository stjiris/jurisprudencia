let indexer = require("./indexer");
let client = indexer._client;

client.search({
    index: indexer.mapping.index,
    query: {
        bool: {
            must: [
                {
                    wildcard: {
                        "Descritores.keyword": "*\n*"
                    }
                },
                {
                    term: {
                        "Origem": "csm-indexer"
                    }
                }
            ]
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

    res = await client.search({
        index: indexer.mapping.index,
        query: {
            bool: {
                must_not: [
                    {
                        wildcard: {
                            "Descritores.keyword": "*\n*"
                        }
                    },
                    {
                        wildcard: {
                            "Descritores.keyword": "* *"
                        }
                    }
                ],
                must: [
                    {
                        exists: {
                            field: "Descritores"
                        }
                    },
                    {
                        term: {
                            "Origem": "csm-indexer"
                        }
                    }
                ]
            }
        },
        scroll: '30s',
        _source: ["Descritores"]
    });
    while(res.hits.hits.length){
        for(let hit of res.hits.hits){
            await client.update({
                id: hit._id,
                index: indexer.mapping.index,
                doc: {
                    Descritores: [hit._source.Descritores.join(" ")]
                }
            })
        }
        res = await client.scroll({
            scroll_id: res._scroll_id,
            scroll: '30s'
        });
    }
});
