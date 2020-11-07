const config = require('../config.json')

const { Pool } = require('pg')
const pool = new Pool(config.database)

const semver = require('semver-parser')
const fs = require('fs')
const availableVersions = fs.readdirSync('./pg-migrations').filter((file) => file.endsWith('.js') && semver.isValidSemVer(file.split('.js')[0], false)).map((file) => file.split('.js')[0])

const inquirer = require('inquirer');

(async () => {
    let lastUpdate

    try {
        lastUpdate = fs.readFileSync('./pg-migrations/.lastupdate', 'utf8')
    } catch (e) {
        console.log(e)
        const answers = await inquirer.prompt([
            {
                type: 'input',
                validate: (input) => semver.isValidSemVer(input, false),
                message: 'Entrez la version actuelle de votre base de données PostgreSQL',
                name: 'version'
            }
        ])
        lastUpdate = answers.version
    }

    const needToBeAppliedVersions = availableVersions.filter((version) => semver.compareSemVer(version, lastUpdate, false) > 0)

    for (const version of needToBeAppliedVersions) {
        const migrationFile = require(`./${version}.js`)
        migrationFile.run(pool)
    }

    if (needToBeAppliedVersions.length > 0) {
        fs.writeFileSync('./pg-migrations/.lastupdate', needToBeAppliedVersions.sort((a, b) => -(semver.compareSemVer(a, b, false)))[0], 'utf-8')
    }
})()
