module.exports = {
    env: {
        commonjs: true,
        es2020: true,
        node: true
    },
    extends: [
        'standard'
    ],
    parserOptions: {
        ecmaVersion: 12
    },
    rules: {
        indent: ['error', 4],
        'no-useless-escape': 0
    }
}
