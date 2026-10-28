// 演示模式：还没部署 Google 后台时（config.js 里 API_URL 为空），预约数据只存在这台设备的浏览器里，
// 规则和正式后台完全一样（同一份 core.js）。店主后台演示密码：1234
function createDemoStore(cfg) {
  var KEY = 'sam-barbershop-demo-v1'
  var state

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch (e) { return null }
  }
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(state)) } catch (e) {}
  }

  function now() {
    var parts = {}
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date()).forEach(function (p) { parts[p.type] = p.value })
    return { date: parts.year + '-' + parts.month + '-' + parts.day, minutes: Number(parts.hour) * 60 + Number(parts.minute) }
  }

  // 第一次打开时放几条示例预约，店主后台才有东西看
  function seed() {
    var today = now().date
    var d = new Date(today + 'T00:00:00Z')
    var toNext = (cfg.openWeekdays[0] - d.getUTCDay() + 7) % 7
    var day = function (offset) {
      var x = new Date(d); x.setUTCDate(x.getUTCDate() + toNext + offset); return x.toISOString().slice(0, 10)
    }
    var mk = function (date, time, name, phone, payment, tip) {
      return { id: date + '_' + time.replace(':', '') + '_demo', date: date, time: time, name: name, phone: phone, payment: payment,
        price: cfg.price, tip: tip, status: 'booked', createdAt: '', cancelledAt: '', minutes: cfg.slotMinutes }
    }
    return {
      settings: {},
      bookings: [
        mk(day(0), '14:00', 'Lily', '19125550101', 'cash', 5),
        mk(day(0), '14:45', 'Kevin', '19125550102', 'zelle', 10),
        mk(day(0), '19:15', 'Amy Chen', '19125550103', 'zelle', 0),
        mk(day(7), '15:30', 'David', '19125550104', 'cash', 0),
        mk(day(-7), '14:00', '阿杰', '19125550105', 'cash', 5),
        mk(day(-7), '15:30', 'Sophia', '19125550106', 'zelle', 10),
        mk(day(-14), '16:15', 'Mike', '19125550107', 'cash', 0)
      ]
    }
  }

  state = read() || seed()
  write()

  return {
    listBookings: function () { return state.bookings.map(function (b) { return Object.assign({}, b) }) },
    addBooking: function (b) { state.bookings.push(b); write() },
    updateBooking: function (id, patch) {
      state.bookings.forEach(function (b) { if (b.id === id) Object.assign(b, patch) })
      write()
    },
    getSettings: function () { return state.settings },
    saveSettings: function (s) { state.settings = s; write() },
    now: now,
    lock: function (fn) { return fn() },
    sendMail: function (subject, text, to) { console.info('[演示模式] 本来会发邮件给' + (to || '店主') + '：', subject, '\n' + text) },
    checkPassword: function (pw) { return String(pw || '') === '1234' },
    reset: function () { state = seed(); write() }
  }
}
