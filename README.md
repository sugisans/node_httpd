# node_httpd

Execute = $node bin/httpd.js

Default access = http://localhost:3000

Setting file = ./etc/config.json

Top directory = ./www


Examples

        View files are html or ejs

        ./www/example.html

        ./www/example.ejs

        ./www/css/example.css

        ./www/js/example.js

        ./www/img/example.jpg


ENV value of ejs

        POST['name']

        GET['name']

        COOKIE['name']      DEFINE['response'].setHeader('Set-Cookie', [`value; expires; max-age`]);

        DEFINE['name']      ./etc/define.json

