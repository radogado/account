component=account
./node_modules/sass/sass.js $component.scss > $component.css
./node_modules/clean-css-cli/bin/cleancss -o $component.min.css $component.css
./node_modules/terser/bin/terser -o $component.min.js --compress --mangle --source-map includeSources -- $component.js
./node_modules/gzip-size-cli/cli.js --raw $component.min.css > $component.min.css.size
./node_modules/gzip-size-cli/cli.js --raw $component.min.js > $component.min.js.size
