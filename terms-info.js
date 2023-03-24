const es = require('@elastic/elasticsearch')
const client = new es.Client({ node: process.env.ES_URL || 'http://localhost:9200' });

const Index = module.exports.Index = "terms-info.0.0";
const Properties = module.exports.Properties = {
    "text": {
        type: 'text'
    }
}

module.exports.delete = () => client.indices.delete({ index: Index });
module.exports.exists = () => client.indices.exists({ index: Index });
module.exports.create = () => client.indices.create({
    index: Index,
    mappings: {
        properties: Properties
    },
    settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        max_result_window: 1
    }
});

if( require.main == module ){
    module.exports.exists().then( async exists => {
        if( !exists ){
            console.log("Creating index...", Index);
            await module.exports.create();
        }
        else{
            console.log("Index already exists", Index);
        }
    }).catch( err => {
        console.log( err );
    });
}