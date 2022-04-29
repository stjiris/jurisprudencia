const ECLI = require('./util/ecli');
const fixes = {
    "http://www.dgsi.pt/jtrl.nsf/33182fc732316039802565fa00497eec/9a5395430007aec6802582cf004eeeb3?OpenDocument": {Data: "21/06/2018", "Data do Acórdão": "21/06/2018"},
    "http://www.dgsi.pt/jtre.nsf/134973db04f39bf2802579bf005f080b/f0611ae129477aae8025827b002d2a47?OpenDocument": {Data: "10/04/2018", "Data do Acórdão": "10/04/2018"},
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/ecf6730f98261130802571f800347524?OpenDocument": {Data: "26/09/2006", "Data do Acórdão": "26/09/2006"},
    "http://www.dgsi.pt/jtrg.nsf/86c25a698e4e7cb7802579ec004d3832/765d9792c9acf919802581ad0052038e?OpenDocument": {Data: "29/06/2017", "Data do Acórdão": "29/06/2017"},
    "http://www.dgsi.pt/jtcn.nsf/89d1c0288c2dd49c802575c8003279c7/75619824943bd597802580020032792e?OpenDocument": {Data: "01/07/2016", "Data do Acórdão": "01/07/2016"},
    "http://www.dgsi.pt/jtre.nsf/134973db04f39bf2802579bf005f080b/32227fea7dac58e4802581d900341950?OpenDocument": {Data: "26/10/2017", "Data do Acórdão": "26/10/2017"},
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/f4e14249caaf440580257685005a67ad?OpenDocument": {Data: "03/12/2009", "Data do Acórdão": "03/12/2009"},
    "http://www.dgsi.pt/jtca.nsf/170589492546a7fb802575c3004c6d7d/c46ce01b55ca0f7480257760005a89fe?OpenDocument": {Data: "08/07/2010", "Data do Acórdão": "08/07/2010"},
    "http://www.dgsi.pt/jtrp.nsf/56a6e7121657f91e80257cda00381fdf/ea09f737fc55389b80257290003ba162?OpenDocument": {Relator: "PEDRO M MENEZES"},
    "https://www.tribunalconstitucional.pt/tc/acordaos/20220123.html": {Data: "03/02/2022"}
}

module.exports = (jsonBody) => {
    let res = {};
    for( let key in jsonBody){
        res[key] = jsonBody[key];
        if( key == "Relator" ){
            res[key] = res[key].replace(/\s{2,10}/g, " ").replace(/\./g, "").trim(); // Remove dots and spaces
        }
    }
    let link = jsonBody["Original URL"];
    if( fixes[link] ){
        console.log("Fixing", link);
        for( let key in fixes[link]){
            res[key] = fixes[link][key];
        }
        if( "Data" in fixes[link] ){
            res.ECLI = ECLI.fromString(jsonBody.ECLI).setYear(fixes[link].Data.substr(6,4)).build();
        }
    }
    return res;
}

module.exports.fixes = Object.keys(fixes);