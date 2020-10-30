const Collection = require('@discordjs/collection')
const pronote = require('pronote-api')
const DATE_END_OF_YEAR = new Date(Date.now() + 31536000000)

class PronoteService {
    constructor () {
        this.casCache = new Collection()
    }

    parsePronoteURL (url) {
        let newURL = url
        if (!url.endsWith('/pronote/') || !url.endsWith('/pronote')) {
            const lastPosition = url.indexOf('/pronote/');
            newURL = url.substring(0, lastPosition + '/pronote/'.length)
        }
        return newURL
    }

    async resolveCas ({ pronoteUsername, pronotePassword, pronoteURL }) {
        if (this.casCache.has(pronoteURL)) {
            return this.casCache.get(pronoteURL)
        } else {
            const possiblesCas = await pronote.getCAS(pronoteURL).catch(() => {})
            if (!possiblesCas) {
                return {
                    cas: 'none'
                }
            } else if (typeof possiblesCas === 'string') {
                return {
                    cas: possiblesCas
                }
            } else {
                const promises = possiblesCas.map((cas) => pronote.login(pronoteURL, pronoteUsername, pronotePassword, cas).catch(() => {}))
                const results = await Promise.all(promises)
                const cas = possiblesCas[results.findIndex((r) => r !== undefined)]
                return {
                    cas,
                    session: results.find((r) => r !== undefined)
                }
            }
        }
    }

    async checkSession (userAuth, oldCache = {}) {
        const notifications = []
        let newCache = oldCache

        const session = await this.createSession(userAuth)

        // Vérification des devoirs
        const homeworks = await session.homeworks(Date.now(), DATE_END_OF_YEAR)
        if (oldCache.homeworksCache) {
            const newHomeworks = homeworks.filter((work) => !(oldCache.homeworksCache.some((cacheWork) => cacheWork.description === work.description)))
            if (newHomeworks.length > 0 && newHomeworks.length <= 3) {
                newHomeworks.forEach((work) => notifications.push({
                    type: 'homework',
                    title: `Nouveau devoir en ${work.title}`,
                    body: work.description
                }))
            }
        }

        // Mise à jour du cache pour les devoirs
        newCache = {
            ...newCache,
            ...{
                homeworksCache: homeworks
            }
        }

        const marks = await session.marks('trimester')
        if (oldCache.marksCache) {
            const marksNotifications = []
            marks.subjects.forEach((subject) => {
                const cachedSubject = oldCache.marksCache.subjects.find((sub) => sub.name === subject.name)
                if (cachedSubject) {
                    const newMarks = subject.marks.filter((mark) => !(cachedSubject.marks.some((cacheMark) => cacheMark.id === mark.id)))
                    newMarks.forEach((mark) => marksNotifications.push({ subject, mark }))
                } else {
                    subject.marks.forEach((mark) => marksNotifications.push({ subject, mark }))
                }
            })
            if (marksNotifications.length > 0 && marksNotifications.length < 3) {
                marksNotifications.forEach((markNotif) => {
                    notifications.push({
                        type: 'mark',
                        title: `Nouvelle note en ${markNotif.subject.name}`,
                        body: `Note: ${markNotif.mark.value}/${markNotif.mark.scale}\nMoyenne de la classe: ${markNotif.mark.average}/${markNotif.mark.scale}`
                    })
                })
            }
        }

        // Mise à jour du cache pour les notes
        newCache = {
            ...newCache,
            ...{
                marksCache: marks
            }
        }

        // Déconnexion de Pronote
        session.logout()

        return [notifications, newCache]
    }

    createSession ({ pronoteUsername, pronotePassword, pronoteURL, pronoteCAS }) {
        return new Promise((resolve, reject) => {
            try {
                pronote.login(pronoteURL, pronoteUsername, pronotePassword, pronoteCAS || 'none', 'student').then((session) => {
                    resolve(session)
                }).catch((error) => {
                    console.log(error)
                    reject(error)
                })
            } catch {
                // eslint-disable-next-line prefer-promise-reject-errors
                reject()
            }
        })
    }
}

module.exports = PronoteService
