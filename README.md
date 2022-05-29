#node_httpd

Execute $node/bin/httpd.js

Top directory = ./www

View files are html or ejs


Examples

        ./www/example.html

        ./www/example.ejs

        ./www/css/example.css

        ./www/js/example.js

        ./www/img/example.jpg


ENV value of ejs

        POST['name']

        GET['name']

        COOKIE['name']      response.setHeader('Set-Cookie', [`value; expires; max-age`]);
        
        DEFINE['name']      ./etc/define.json

Setting file        ./etc/config.json