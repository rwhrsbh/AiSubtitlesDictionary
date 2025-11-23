const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
    mode: 'production',
    entry: {
        'src/background/background': './src/background/background.js',
        'src/popup/popup': './src/popup/popup.js',
        'src/content/youtube_injector': './src/content/youtube_injector.js',
        'src/content/rezka_injector': './src/content/rezka_injector.js',
        'src/content/word_popup': './src/content/word_popup.js',
        'src/content/subtitle_renderer': './src/content/subtitle_renderer.js',
        'src/content/i18n_lib': './src/content/i18n_lib.js',
        'src/content/network_interceptor': './src/content/network_interceptor.js',
        'src/review/review': './src/review/review.js',
        'src/flashcards/flashcards': './src/flashcards/flashcards.js',
        'src/definition-cards/definition-cards': './src/definition-cards/definition-cards.js',
        'src/context-cards/context-cards': './src/context-cards/context-cards.js'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
        clean: true
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env']
                    }
                }
            }
        ]
    },
    resolve: {
        extensions: ['.js']
    },
    optimization: {
        minimize: true,
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    format: {
                        comments: false,
                    },
                    compress: {
                        drop_console: true,
                        drop_debugger: true,
                    },
                },
                extractComments: false,
            }),
        ],
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                { from: 'manifest.json', to: 'manifest.json' },
                { from: '_locales', to: '_locales' },
                { from: 'src/assets', to: 'src/assets' },
                { from: 'src/**/*.html', to: '[path][name][ext]' },
                { from: 'src/**/*.css', to: '[path][name][ext]' },
                { from: 'src/services/translations.js', to: 'src/services/translations.js' }
            ],
        }),
    ],
};
