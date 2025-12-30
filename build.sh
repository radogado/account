component=account
./node_modules/sass/sass.js css/$component.scss > css/$component.css
./node_modules/clean-css-cli/bin/cleancss -o dist/$component.min.css css/$component.css
./node_modules/esbuild/bin/esbuild src/main.js --bundle --format=esm --minify --sourcemap --outfile=dist/$component.min.js
./node_modules/gzip-size-cli/cli.js --raw dist/$component.min.css > $component.min.css.size
./node_modules/gzip-size-cli/cli.js --raw dist/$component.min.js > $component.min.js.size
