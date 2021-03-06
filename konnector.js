const request = require('request').defaults({
  jar: true
})
// require('request-debug')(request)
const moment = require('moment')
const cheerio = require('cheerio')

const {log, baseKonnector, filterExisting, saveDataAndFile, models} = require('cozy-konnector-libs')
const Bill = models.bill

// Konnector
module.exports = baseKonnector.createNew({
  name: 'SFR Box',
  vendorLink: 'espace-client.sfr.fr/facture-fixe/consultation',
  category: 'telecom',
  color: {
    hex: '#9E0017',
    css: 'linear-gradient(90deg, #EF0001 0%, #9E0017 100%)'
  },

  dataType: ['bill'],

  models: [Bill],
  fetchOperations: [
    getToken,
    logIn,
    fetchBillingInfo,
    parsePage,
    customFilterExisting,
    customSaveDataAndFile
  ]
})

// Procedure to get the login token
function getToken (requiredFields, bills, data, next) {
  const url = 'https://www.sfr.fr/bounce?target=//www.sfr.fr/sfr-et-moi/bounce.html&casforcetheme=mire-sfr-et-moi&mire_layer'
  const options = {
    url,
    method: 'GET'
  }

  log('info', 'Logging in on Sfr Website...')

  request(options, (err, res, body) => {
    if (err) {
      log('error', err)
      return next('token not found')
    }

    const $ = cheerio.load(body)
    data.token = $('input[name=lt]').val()

    log('info', 'Token retrieved')
    return next()
  })
}

// Procedure to login to Sfr website.
function logIn (requiredFields, bills, data, next) {
  const options = {
    method: 'POST',
    url: 'https://www.sfr.fr/cas/login?domain=mire-sfr-et-moi&service=https://www.sfr.fr/accueil/j_spring_cas_security_check#sfrclicid=EC_mire_Me-Connecter',
    form: {
      lt: data.token,
      execution: 'e1s1',
      _eventId: 'submit',
      username: requiredFields.login,
      password: requiredFields.password,
      identifier: ''
    }
  }

  log('info', 'Logging in on Sfr website...')
  request(options, (err, res, body) => {
    if (err) {
      log('error', err)
      return next('LOGIN_FAILED')
    }

    // check if an element with class error-icon is present
    const $ = cheerio.load(body)
    const badLogin = $('#username').length > 0
    if (badLogin) {
      return next('LOGIN_FAILED')
    }

    log('info', 'Successfully logged in.')
    return next()
  })
}

function fetchBillingInfo (requiredFields, bills, data, next) {
  const url = 'https://espace-client.sfr.fr/facture-fixe/consultation'

  log('info', 'Fetch bill info')
  const options = {
    method: 'GET',
    url
  }
  request(options, (err, res, body) => {
    if (err) {
      log('error', 'An error occured while fetching bills')
      log('error', err)
      return next('request error')
    }
    log('info', 'Fetch bill info succeeded')

    data.html = body
    return next()
  })
}

function parsePage (requiredFields, bills, data, next) {
  bills.fetched = []
  moment.locale('fr')
  const $ = cheerio.load(data.html)
  const baseURL = 'https://espace-client.sfr.fr'

  const firstBill = $('#facture')
  const firstBillUrl = $('#lien-telecharger-pdf').attr('href')

  if (firstBillUrl) {
    // The year is not provided, but we assume this is the current year or that
    // it will be provided if different from the current year
    let firstBillDate = firstBill.find('tr.header h3').text().substr(17)
    firstBillDate = moment(firstBillDate, 'D MMM YYYY')

    const price = firstBill.find('tr.total td.prix').text()
                                                    .replace('€', '')
                                                    .replace(',', '.')

    const bill = {
      date: firstBillDate,
      type: 'Box',
      amount: parseFloat(price),
      pdfurl: `${baseURL}${firstBillUrl}`,
      vendor: 'Sfr'
    }

    bills.fetched.push(bill)
  } else {
    log('info', 'wrong url for first PDF bill.')
  }

  $('#tab tr').each(function each () {
    let date = $(this).find('.date').text()
    let prix = $(this).find('.prix').text()
                                    .replace('€', '')
                                    .replace(',', '.')
    let pdf = $(this).find('.liens a').attr('href')

    if (pdf) {
      date = date.split(' ')
      date.pop()
      date = date.join(' ')
      date = moment(date, 'D MMM YYYY')
      prix = parseFloat(prix)
      pdf = `${baseURL}${pdf}`

      const bill = {
        date,
        type: 'Box',
        amount: prix,
        pdfurl: pdf,
        vendor: 'Sfr'
      }
      bills.fetched.push(bill)
    } else {
      log('info', 'wrong url for PDF bill.')
    }
  })

  log('info', 'Successfully parsed the page')
  next()
}

function customFilterExisting (requiredFields, bills, data, next) {
  filterExisting(null, Bill)(requiredFields, bills, data, next)
}

function customSaveDataAndFile (requiredFields, bills, data, next) {
  const fnsave = saveDataAndFile(null, Bill, 'sfr', ['bill'])
  fnsave(requiredFields, bills, data, next)
}
