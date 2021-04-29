require('tls').DEFAULT_MIN_VERSION = 'TLSv1'

const config = require('./config.json')
const fetch = require('node-fetch')

const Sentry = require('@sentry/node')
Sentry.init({
    dsn: config.sentryDSN,
    tracesSampleRate: 1.0
})

// Start express server
const morgan = require('morgan')
const express = require('express')
const app = express()
app.use(express.json())
app.use(morgan('dev'))
app.listen(config.port, () => console.log(`Pronote Notifications API server listening on port ::${config.port}::`))

const DatabaseService = require('./services/database')
const PronoteService = require('./services/pronote')
const FirebaseService = require('./services/firebase')
const jwt = require('./services/jwt')

const database = new DatabaseService()
const pronote = new PronoteService()
const firebase = new FirebaseService()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const synchronize = async (studentName) => {
    const users = await database.fetchUsers()
    const usersCaches = await database.fetchUsersCache()
    const usersTokens = await database.fetchFCMTokens()

    const usersSync = users.filter((user) => !user.passwordInvalidated && (studentName ? user.pronoteUsername === studentName : true))
    for (const [index, userAuth] of usersSync.entries()) {
        await sleep(500)
        const oldCache = usersCaches.find((cache) => {
            return cache.pronoteUsername === userAuth.pronoteUsername && cache.pronoteURL === userAuth.pronoteURL
        })
        pronote.checkSession(userAuth, oldCache, index).then(([notifications, newCache]) => {
            if (notifications.length > 0) {
                const tokens = usersTokens.filter((token) => {
                    return token.pronoteUsername === userAuth.pronoteUsername && token.pronoteURL === userAuth.pronoteURL && token.isActive
                })
                const homeworksTokens = tokens.filter((token) => token.notificationsHomeworks).map((token) => token.fcmToken)
                const marksTokens = tokens.filter((token) => token.notificationsMarks).map((token) => token.fcmToken)
                notifications.forEach((notificationData) => {
                    database.createNotification(userAuth, notificationData).then((notificationDataDB) => {
                        const notification = {
                            title: notificationData.title,
                            body: notificationData.body
                        }
                        const sentAt = new Date()
                        if (notificationData.type === 'homework' && homeworksTokens.length > 0) {
                            firebase.sendNotification(notification, 'homework', homeworksTokens).then((responses) => {
                                database.markNotificationSent(notificationDataDB.id, new Date())
                                responses.forEach((res, i) => {
                                    const token = marksTokens[i]
                                    database.markLastActiveAt(token, sentAt)
                                    if (res.success) database.markLastSuccessAt(token, sentAt)
                                })
                            })
                        } else if (notificationData.type === 'mark' && marksTokens.length > 0) {
                            firebase.sendNotification(notification, 'mark', marksTokens).then((responses) => {
                                database.markNotificationSent(notificationDataDB.id, new Date())
                                responses.forEach((res, i) => {
                                    const token = marksTokens[i]
                                    database.markLastActiveAt(token, sentAt)
                                    if (res.success) database.markLastSuccessAt(token, sentAt)
                                })
                            })
                        }
                    })
                })
            }
            database.updateUserCache(userAuth, newCache)
        }).catch((e) => {
            if (e.message === 'Wrong user credentials') {
                database.invalidateUserPassword(userAuth)
            }
        })
    }
}

const checkInvalidated = async () => {
    const users = await database.fetchUsers()
    const usersInvalidated = users.filter((u) => u.passwordInvalidated)
    const failed = []
    usersInvalidated.forEach((user) => {
        if (failed.filter((e) => e === user.pronoteURL).length < 1) {
            pronote.createSession(user).then(() => {
                database.invalidateUserPassword(user, false)
            }).catch(() => {
                failed.push(user.pronoteURL)
            })
        }
    })
}

const userToSynchronize = process.argv[process.argv.indexOf('--sync') + 1] === 'all' ? null : process.argv[process.argv.indexOf('--sync') + 1]
if (process.argv.includes('--sync')) synchronize(userToSynchronize)
if (process.argv.includes('--checkinv')) checkInvalidated()

setInterval(function () {
    synchronize()
}, 30 * 60 * 1000)
setInterval(() => {
    checkInvalidated()
}, 24 * 60 * 60 * 1000)

app.post('/logout', async (req, res) => {
    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }
    database.createUserLog(payload, {
        route: '/logout',
        appVersion: req.headers['app-version'] || 'unknown',
        date: new Date(),
        jwt: token
    })

    if (payload.pronoteURL === 'demo') {
        return res.status(200).send({
            success: true
        })
    }

    const existingToken = await database.verifyFCMToken(payload.fcmToken)
    if (!existingToken) {
        return res.status(500).send({
            success: false,
            code: 4,
            message: 'Unknown FCM token'
        })
    }

    database.updateToken(payload.fcmToken, {
        isActive: false
    })
    return res.status(200).send({
        success: true
    })
})

app.post('/settings', async (req, res) => {
    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }
    const data = req.body
    database.createUserLog(payload, {
        route: '/settings',
        appVersion: req.headers['app-version'] || 'unknown',
        date: new Date(),
        body: data,
        jwt: token
    })

    if (payload.pronoteURL === 'demo') {
        return res.status(200).send({
            success: true
        })
    }

    const existingToken = await database.verifyFCMToken(payload.fcmToken)
    if (!existingToken) {
        return res.status(500).send({
            success: false,
            code: 4,
            message: 'Unknown FCM token'
        })
    }

    database.updateToken(payload.fcmToken, {
        notificationsHomeworks: data.notifications_homeworks === 'true',
        notificationsMarks: data.notifications_marks === 'true'
    })
    return res.status(200).send({
        success: true
    })
})

app.get('/notifications', async (req, res) => {
    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }

    database.createUserLog(payload, {
        route: '/notifications',
        appVersion: req.headers['app-version'] || 'unknown',
        date: new Date(),
        jwt: token
    })

    if (payload.pronoteURL === 'demo') {
        const minDate = new Date(2012, 0, 1)
        const randomDate = () => new Date(minDate.getTime() + Math.random() * (Date.now() - minDate.getTime()))
        return res.status(200).send({
            success: true,
            notifications: [
                {
                    pronoteURL: 'demo',
                    pronoteUsername: 'demo',
                    createdAt: randomDate(),
                    readAt: randomDate(),
                    sentAt: randomDate(),
                    body: 'Nouvelle note en HISTOIRE-GEOGRAPHIE',
                    title: 'Note: 19/20\nMoyenne de la classe: 11.91/20',
                    type: 'mark'
                }
            ]
        })
    }

    const user = await database.fetchUser(payload.pronoteUsername, payload.pronoteURL)
    if (!user) {
        return res.status(403).send({
            success: false,
            code: 3,
            message: 'Votre compte est introuvable.'
        })
    }

    const notifications = (await database.fetchUserNotifications(payload.pronoteUsername, payload.pronoteURL))
        .sort((a, b) => {
            const createdOrder = b.createdAt.getTime() - a.createdAt.getTime()
            if (createdOrder !== 0) return createdOrder
            else return b.body.length - a.body.length
        })

    return res.status(200).send({
        success: true,
        notifications
    })
})

app.get('/login', async (req, res) => {
    const token = req.headers.authorization
    const payload = jwt.verifyToken(token)
    if (!token || !payload) {
        return res.status(403).send({
            success: false,
            code: 2,
            message: 'Unauthorized'
        })
    }

    database.createUserLog(payload, {
        route: '/login',
        appVersion: req.headers['app-version'] || 'unknown',
        date: new Date(),
        jwt: token
    })

    if (payload.pronoteURL === 'demo') {
        return res.status(200).send({
            success: true,
            avatar_base64: null,
            full_name: 'Sarah Kelly',
            student_class: '204',
            establishment: 'Lycée Gustave Eiffel',
            notifications_homeworks: true,
            notifications_marks: true
        })
    }

    const user = await database.fetchUser(payload.pronoteUsername, payload.pronoteURL)
    if (!user) {
        return res.status(403).send({
            success: false,
            code: 3,
            message: 'Votre compte est introuvable.'
        })
    } else {
        const existingToken = await database.verifyFCMToken(payload.fcmToken)
        if (!existingToken) {
            return res.status(500).send({
                success: false,
                code: 4,
                message: 'Unknown FCM token'
            })
        }

        console.log('coucou')
        console.log({
            success: true,
            avatar_base64: user.avatarBase64,
            full_name: user.fullName,
            student_class: user.studentClass,
            establishment: user.establishment,
            password_invalidated: user.passwordInvalidated,
            notifications_homeworks: existingToken.notificationsHomeworks,
            notifications_marks: existingToken.notificationsMarks
        })

        return res.status(200).send({
            success: true,
            avatar_base64: user.avatarBase64,
            full_name: user.fullName,
            student_class: user.studentClass,
            establishment: user.establishment,
            password_invalidated: user.passwordInvalidated,
            notifications_homeworks: existingToken.notificationsHomeworks,
            notifications_marks: existingToken.notificationsMarks
        })
    }
})

app.get('/establishments', async (req, res) => {
    if (!req.query.latitude || !req.query.longitude) return

    database.createUserLog({
        pronoteUsername: 'unknown',
        pronoteURL: 'unknown',
        fcmToken: 'unknown'
    }, {
        route: '/establishments',
        appVersion: req.headers['app-version'] || 'unknown',
        date: new Date(),
        body: { latitude: req.query.latitude, longitude: req.query.longitude }
    })

    const establishments = (await pronote.getEstablishments(req.query.latitude, req.query.longitude)) || []

    return res.status(200).send({
        success: true,
        establishments
    })
})

app.post('/register', async (req, res) => {
    const body = req.body
    const userAuth = {
        pronoteUsername: body.pronote_username,
        pronotePassword: body.pronote_password,
        pronoteURL: pronote.parsePronoteURL(body.pronote_url),
        fcmToken: body.fcm_token
    }

    if (Object.values(userAuth).some((v) => v === undefined)) {
        return res.status(400).send({
            success: false,
            message: 'BAD REQUEST. Essayez de mettre à jour l\'application et réessayez !'
        })
    }

    if (body.device_id) userAuth.deviceID = body.device_id

    database.createUserLog(userAuth, {
        route: '/register',
        appVersion: req.headers['app-version'] || 'unknown',
        date: new Date(),
        body: userAuth
    })

    const token = jwt.createToken(userAuth)

    const isValidToken = await firebase.verifyToken(userAuth.fcmToken)
    if (!isValidToken) {
        return res.status(403).send({
            success: false,
            message: 'Impossible de valider le token FCM.'
        })
    }

    if (userAuth.pronoteURL === 'demo') {
        return res.status(200).send({
            success: true,
            avatar_base64: null,
            full_name: 'Sarah Kelly',
            student_class: '204',
            establishment: 'Lycée Gustave Eiffel',
            notifications_homeworks: true,
            notifications_marks: true,
            jwt: token
        })
    }

    let { cas, session } = await pronote.resolveCas(userAuth)
    userAuth.pronoteCAS = cas

    if (!session) {
        session = await pronote.createSession(userAuth).catch((error) => {
            let message = 'Connexion à Pronote impossible car l\'URL Pronote entrée est invalide. Fermez la pop-up et cliquez sur "Q\'est-ce que "URL Pronote" ou rejoignez notre serveur Discord : https://androz2091.fr/discord pour plus d\'informations. Tous les lycées et collèges étant supportés, nous vous aiderons à trouver la bonne URL.'
            if (error.code === 3) message = 'Connexion à Pronote réussie mais vos identifiants sont incorrects. Vérifiez et réessayez !'
            if (error.code === 2) message = 'Le serveur de Notifications pour Pronote est actuellement indisponible. Réessayez dans quelques minutes !'
            res.status(403).send({
                success: false,
                message
            })
            return null
        })
    }

    if (!session) return

    const user = await database.fetchUser(userAuth.pronoteUsername, userAuth.pronoteURL)

    if (user) {
        if (user.pronotePassword !== userAuth.pronotePassword) {
            database.updateUserPassword({
                pronoteUsername: userAuth.pronoteUsername,
                pronoteURL: userAuth.pronoteURL,
                newPassword: userAuth.pronotePassword
            })
        }
        database.invalidateUserPassword(userAuth, false)
        res.status(200).send({
            success: true,
            avatar_base64: user.avatarBase64,
            full_name: user.fullName,
            student_class: user.studentClass,
            establishment: user.establishment,
            password_invalidated: user.passwordInvalidated,
            notifications_homeworks: true,
            notifications_marks: true,
            jwt: token
        })
    } else {
        const fetchAvatarPm = new Promise((resolve) => {
            if (!session.user.avatar) resolve()
            else {
                fetch(session.user.avatar).then((result) => {
                    result.buffer().then((buffer) => {
                        const imageBuffer = Buffer.from(buffer).toString('base64')
                        resolve(imageBuffer)
                    })
                }).catch(() => resolve())
            }
        })
        fetchAvatarPm.then((imageBuffer) => {
            res.status(200).send({
                success: true,
                avatar_base64: imageBuffer || '',
                full_name: session.user.name,
                student_class: session.user.studentClass.name,
                establishment: session.user.establishment.name,
                notifications_homeworks: true,
                notifications_marks: true,
                jwt: token
            })
            database.createUser({
                ...userAuth,
                ...{
                    avatarBase64: imageBuffer || '',
                    fullName: session.user.name,
                    studentClass: session.user.studentClass.name,
                    establishment: session.user.establishment.name
                }
            })
            pronote.checkSession(userAuth, {}).then(([notifications, cache]) => {
                database.updateUserCache(userAuth, cache)
            })
        })
    }
    database.createOrUpdateToken(userAuth, userAuth.fcmToken, userAuth.deviceID)
})

app.get('*', (req, res) => res.send({
    success: true, message: 'Welcome to Notifications pour Pronote API'
}))
