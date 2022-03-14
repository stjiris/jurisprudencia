function strip_html(string, allowtags, keepattrs){
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

function strip_attrs(string){
    let regex = /<(?<closing>\/?)(?<tag>\w+)(?<attrs>[^>]*)>/g;
    var comments = /<!--[\s\S]*?-->/gi;
    return string.replace(comments, '').replace(regex, "<$1$2>");
}

function strip_empty_html(string){
    let html = strip_attrs(string);
    let regex = /<(\w+)>\s*<\/\1>/g;
    let r = html.replace(regex, '');
    // Loop until no more empty tags
    while( r != html ){
        html = r;
        r = html.replace(regex, '');
    }
    // Loop to remove font tags
    let regex2 = /<\/?font>/g;
    r = html.replace(regex2, '');
    while( r != html ){
        html = r;
        r = html.replace(regex2, '');
    }
    return r;
}

module.exports = {
    strip_html,
    strip_attrs,
    strip_empty_html,
}