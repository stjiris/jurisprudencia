module.exports.strip_html = function strip_html(string, allowtags, keepattrs){
    var allowtags = allowtags || '';
    let regex = /<(?<closing>\/?)(?<tag>\w+)(?<attrs>[^>]*)>/g;
    var comments = /<!--[\s\S]*?-->/gi;
    return string.replace(comments, '').replace(regex, function(match, closing, tag, attrs){
        void(attrs)
        if( allowtags.indexOf(tag) > -1 ){
            if( keepattrs ){
                return match;
            }
            return `<${closing}${tag}>`;
        }
        return '';
    });
}

module.exports.strip_attrs = function strip_attrs(string){
    let regex = /<(?<closing>\/?)(?<tag>\w+)(?<attrs>[^>]*)>/g;
    var comments = /<!--[\s\S]*?-->/gi;
    return string.replace(comments, '').replace(regex, "<$1$2>");
}