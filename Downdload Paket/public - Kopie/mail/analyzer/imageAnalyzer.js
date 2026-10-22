function analyzeImages(html){

    return{

        total:

            (html.match(/<img/gi)||[]).length,

        cid:

            (html.match(/cid:/gi)||[]).length,

        base64:

            (html.match(/base64,/gi)||[]).length,

        svg:

            (html.match(/<svg/gi)||[]).length,

        picture:

            (html.match(/<picture/gi)||[]).length,

        srcset:

            (html.match(/srcset=/gi)||[]).length

    };

}

window.analyzeImages = analyzeImages;