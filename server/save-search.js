const {Client} = require('@elastic/elasticsearch');
const client = new Client({node: process.env.ES_URL || 'http://localhost:9200'});

const crypto = require("crypto")
const INDEX = "saved-searches.0.0"

client.indices.create({
    index: INDEX,
    mappings: {
        properties: {
            "searchHash": {
                type: 'keyword'
            },
            "searchParams": {
                type: 'keyword'
            },
            "searchClicks": {
                type: 'keyword'
            }
        }
    },
    settings: {
        number_of_shards: 1,
        number_of_replicas: 0,
        max_result_window: 550000
    }
}).catch(e => {
    console.log(e)
});

function shakeHashWithRandomSalt(str){
    let salt = crypto.randomBytes(10).toString('hex') // using salt to make less likely to colide
    let hash = crypto.createHash("shake256", { outputLength: 14 });
    hash.write(str + salt);
    return hash.digest().toString("base64url");
}

module.exports = async function saveSearch(reqString){
    let r = await client.search({ index: INDEX, query: { term: { searchParams: reqString }}, _source: ["searchHash"]});
    if( r.hits.hits.length > 0 ){
        return r.hits.hits[0]._source.searchHash;
    }
    let hashStr = shakeHashWithRandomSalt(reqString);
    r = await client.search({
        index: INDEX,
        query: { term: {searchHash: hashStr}},
        _source: false
    });
    while(r.hits.hits.length > 0){ // prevent new hashes from coliding since we are using only the first 7 bytes
        hashStr = shakeHashWithRandomSalt(reqString);
        r = await client.search({
            index: INDEX,
            query: { term: {searchHash: hashStr}},
            _source: false
        }); 
    }
    await client.index({
        index: INDEX,
        document: {
            searchHash: hashStr,
            searchParams: reqString,
            searchClicks: []
        }
    });

    return hashStr;
}

module.exports.trackClickedDocument = async function trackClickedDocument(searchHash, documentId){
    let r = await client.search({
        index: INDEX,
        query: { term: { searchHash: searchHash } },
        _source: ["searchClicks"]
    }).catch( e => {
        console.log(e);
        return {hits: {hits: []}}
    });
    if( r.hits.hits.length == 0 ) return;

    await client.update({
        index: INDEX,
        id: r.hits.hits[0]._id,
        doc: {
            searchClicks: r.hits.hits[0]._source.searchClicks.concat([documentId])
        }
    }).catch(e => {
        console.log(e);
    });
}

module.exports.getShearchParams = async function getShearchParams(searchHash){
    let r = await client.search({
        index: INDEX,
        query: {
            term: { searchHash: searchHash }
        },
        _source: ["searchParams"]
    }).catch( e => {
        console.log(e);
        return {hits: {hits: []}}
    });
    if( r.hits.hits.length == 0 ) return;

    return r.hits.hits[0]._source.searchParams;
}