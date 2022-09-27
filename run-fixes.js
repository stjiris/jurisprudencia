const { Client } = require('@elastic/elasticsearch');
const client = new Client({ node: process.env.ES_URL });

const fixes = require('./fix-known-errors');

for( let fix of fixes.fixes ){
    client.search({
        index: 'jurisprudencia.1.0',
        query: {
            term: {
                "Original URL": fix
            }
        },
        version: true
    }).then( async res => {
        let fix = fixes(res.hits.hits[0]._source)
        let indexResult = await client.index({
            index: 'jurisprudencia.1.0',
            body: fix,
            id: res.hits.hits[0]._id           
        })
        console.log(fix["Original URL"], indexResult.result)
    })
}