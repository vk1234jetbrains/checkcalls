// db_setup.js
const sqlite3 = require('sqlite3').verbose();

let db = new sqlite3.Database('./likes.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к базе данных лайков:', err.message);
  } else {
    console.log('Connected to the likes database.');
  }
});

db.serialize(() => {
  // Создаём таблицу likes, если её нет
  db.run(`CREATE TABLE IF NOT EXISTS likes (
    player_id INTEGER PRIMARY KEY,
    hearts INTEGER DEFAULT 0
  )`, function(err) {
    if (err) {
      console.error('Error creating likes table:', err.message);
    } else {
      console.log('likes table created or already exists.');
      // Создаём таблицу user_likes, если её нет
      db.run(`CREATE TABLE IF NOT EXISTS user_likes (
        player_id INTEGER,
        user_id INTEGER,
        PRIMARY KEY (player_id, user_id)
      )`, function(err) {
        if (err) {
          console.error('Error creating user_likes table:', err.message);
        } else {
          console.log('user_likes table created or already exists.');

          // Инициализируем таблицу likes с вашими аудиоплеерами
          const playerIds = [
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
            11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
            21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32
          ];

          const stmt = db.prepare('INSERT OR IGNORE INTO likes (player_id) VALUES (?)');

          playerIds.forEach((id) => {
            stmt.run(id);
          });

          stmt.finalize((err) => {
            if (err) {
              console.error('Error finalizing statement:', err.message);
            } else {
              console.log('Initial data inserted into likes table.');
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
        }
      });
    }
  });
});
