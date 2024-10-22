// db_setup_stats.js
const sqlite3 = require('sqlite3').verbose();

let db = new sqlite3.Database('./stats.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к базе данных статистики:', err.message);
  } else {
    console.log('Connected to the stats database.');
  }
});

db.serialize(() => {
  // Создаем таблицу для хранения статистики звонков
  db.run(`CREATE TABLE IF NOT EXISTS call_stats (
    user_id INTEGER PRIMARY KEY,
    call_count INTEGER DEFAULT 0
  )`, function(err) {
    if (err) {
      console.error('Error creating call_stats table:', err.message);
    } else {
      console.log('call_stats table created or already exists.');
    }

    // Закрываем базу данных после завершения всех операций
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('Closed the database connection.');
      }
    });
  });
});
