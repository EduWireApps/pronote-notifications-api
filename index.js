const config = require('./config.json')

// Start express server
const express = require('express')
const app = express()
app.use(express.json())
app.listen(config.port, () => console.log(`Pronote Notifications API server listening on port ::${config.port}::`))

const DatabaseService = require('./services/database')
const PronoteService = require('./services/pronote')
const FirebaseService = require('./services/firebase')

const database = new DatabaseService()
const pronote = new PronoteService()
const firebase = new FirebaseService()

const initDB = Promise.all([database.fetchUsers(), database.fetchCache(), database.fetchTokens()])

app.use('/', async (req, res) => {
    await initDB()

    const body = req.body
    const userAuth = {
        pronoteUsername: body.pronote_username,
        pronotePassword: body.pronote_password,
        pronoteURL: body.pronote_url
    }

    // sera remplacé par un resolveCas
    const cas = 'ac-toulouse'
    userAuth.pronoteCAS = cas

    if (Object.values(userAuth).some((v) => v === undefined)) {
        return res.status(400).send({
            success: false,
            message: 'BAD REQUEST'
        })
    }

    const existingUser = database.users.find((user) => {
        return user.pronoteUsername === userAuth.pronoteUsername && user.pronoteURL === userAuth.pronoteURL
    })

    pronote.createSession(userAuth).then((session) => {
        if (existingUser) {
            if (existingUser.pronotePassword !== userAuth.pronotePassword) {
                database.updateUserPassword({
                    pronoteUsername: userAuth.pronoteUsername,
                    pronoteURL: userAuth.pronoteURL,
                    newPassword: userAuth.pronotePassword
                })
            }
        } else {
            database.createUser(userAuth)
        }

        res.status(200).send({
            success: true,
            message: 'Connexion réussie.',
            name: session.user.username,
            avatar_url: session.user.avatar
        })
    }).catch((error) => {
        let message = 'Connexion à Pronote impossible. Veuillez vérifier vos identifiants et réessayez !'
        if (error.code === 3) message = 'Connexion à Pronote réussie mais vos identifiants sont incorrects. Vérifiez et réessayez !'
        res.status(403).send({
            success: false,
            message
        })
    })
})
