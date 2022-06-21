const fetch = require('./util/fetch.js');
const { Worker } = require("worker_threads")
const { init } = require("./indexer")

init().then( async _ => {
    new Worker("./dgsi-indexer-worker.js", {workerData: {
        Tribunal: "Supremo Tribunal de Justiça",
        TribunalCode: "STJ",
        link : "http://www.dgsi.pt/jstj.nsf?OpenDatabase"
    }})
}).catch(e => {
    console.log(e)
});