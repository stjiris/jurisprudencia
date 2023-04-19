let {Client} = require("@elastic/elasticsearch")
let {JSDOM} = require("jsdom")

let client = new Client({node: process.env.ES_URL || "http://localhost:9200"})

let {Index} = require("./jurisprudencia");

client.indices.create({index: `${Index}.original`, settings: {
    number_of_replicas: 0
},mappings: {
    dynamic_date_formats: "dd/MM/yyyy",
    dynamic_templates: [
        {"_all": {
            match_mapping_type: "string",
            mapping: {
                type: "keyword",
            }
        }}
    ]
}}).catch(e=>null).finally(async _ => {
    await client.indices.putSettings({
        index: `${Index}.original`,
        settings: {
            refresh_interval: '-1'
        } 
    });
    let r = await client.search({index: Index, scroll: '1m', _source: ["Original"]});
    let i = 0;
    while( r.hits.hits.length > 0 ){
        for(let hit of r.hits.hits){
            if( await client.exists({index: `${Index}.original`, id: hit._id, version: hit._version}) ) continue;
            let obj = {};
            for( let key in hit._source.Original ){
                if( key == "" ) continue;
                obj[key] = new JSDOM(hit._source.Original[key]).window.document.body.textContent.trim();
                if( key.match(/data/i) && hit._source.Original[key] == "N/D" || obj[key].length == 0 ) {
                    delete obj[key];
                }
            }
    	    await client.index({index: `${Index}.original`, document: obj, id: hit._id, version: hit._version})
        }
	    r = await client.scroll({scroll:'1m',scroll_id: r._scroll_id})
        i+=r.hits.hits.length
        console.log(i, "/", r.hits.total.value)
    }
    await client.indices.putSettings({
        index: `${Index}.original`,
        settings: {
            refresh_interval: '1s'
        } 
    });
})
