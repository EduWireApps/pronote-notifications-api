const Collection = require('@discordjs/collection')
const pronote = require('pronote-api')

class PronoteService {
    constructor () {
        this.casCache = new Collection()
    }

    parsePronoteURL (url) {
        console.log('Parsing URL ' + url)
        const newURL = url
        /*
        if ((!url.endsWith('/pronote/') || !url.endsWith('/pronote')) && (url.includes('/pronote') || url.includes('/pronote/'))) {
            const lastPosition = url.indexOf('/pronote/')
            newURL = url.substring(0, lastPosition + '/pronote/'.length)
        }
        */
        console.log('Parsed URL ' + newURL)
        return newURL
    }

    async resolveCas ({ pronoteUsername, pronotePassword, pronoteURL }) {
        console.log('Resolving CAS ' + pronoteURL)
        if (this.casCache.has(pronoteURL)) {
            return this.casCache.get(pronoteURL)
        } else {
            const possiblesCas = await pronote.getCAS(pronoteURL).catch(() => {})
            console.log('Results from PAPI: ' + possiblesCas)
            if (!possiblesCas) {
                console.log('Final Result: none')
                return {
                    cas: 'none'
                }
            } else if (typeof possiblesCas === 'string') {
                console.log('Final Result: ' + possiblesCas)
                return {
                    cas: possiblesCas
                }
            } else {
                const promises = possiblesCas.map((cas) => pronote.login(pronoteURL, pronoteUsername, pronotePassword, cas).catch(() => {}))
                const results = await Promise.all(promises)
                const cas = possiblesCas[results.findIndex((r) => r !== undefined)]
                console.log('Final Result: ' + cas)
                return {
                    cas,
                    session: results.find((r) => r !== undefined)
                }
            }
        }
    }

    checkSession (userAuth, oldCache = {}) {
        return new Promise((resolve, reject) => {
            const notifications = []
            let newCache = oldCache

            this.createSession(userAuth).then((session) => {
                // Vérification des devoirs
                session.homeworks(new Date(Date.now()), session.params.lastDay).then((homeworks) => {
                    if (oldCache.homeworksCache) {
                        const newHomeworks = homeworks.filter((work) => !(oldCache.homeworksCache.some((cacheWork) => cacheWork.description === work.description)))
                        if (newHomeworks.length > 0 && newHomeworks.length <= 3) {
                            newHomeworks.forEach((work) => notifications.push({
                                type: 'homework',
                                title: `Nouveau devoir en ${work.subject}`,
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

                    session.marks('trimester').then((marks) => {
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
                                        body: `${markNotif.mark.value ? `Note: ${markNotif.mark.value}/${markNotif.mark.scale}\n` : ''}Moyenne de la classe: ${markNotif.mark.average}/${markNotif.mark.scale}`
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

                        resolve([notifications, newCache])
                    })
                })
            }).catch((e) => {
                reject(e)
            })
        })
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
