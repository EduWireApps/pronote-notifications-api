const { database } = require('../config.json')
const { Client } = require('pg')

const client = new Client(database)
client.connect()
client.query(`
    DELETE FROM users;
    DELETE FROM users_caches;
    DELETE FROM users_tokens;
`, (err, res) => {
    console.log(err, res)
    client.end()
})
