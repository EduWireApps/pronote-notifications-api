const pronote = require('pronote-api')
const DATE_END_OF_YEAR = new Date(Date.now() + 31536000000)

class PronoteService {
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
                    message: work.description
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
        if (oldCache.marks) {
            const marksNotifications = []
            marks.subjects.forEach((subject) => {
                const cachedSubject = oldCache.marks.subjects.find((sub) => sub.name === subject.name)
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
                        message: `Moyenne de la classe: ${markNotif.mark.average}/${markNotif.mark.scale}`
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
            pronote.login(pronoteURL, pronoteUsername, pronotePassword, pronoteCAS || 'none', 'student').then((session) => {
                resolve(session)
            }).catch((error) => {
                console.log(error)
                reject(error)
            })
        })
    }
}

module.exports = PronoteService
