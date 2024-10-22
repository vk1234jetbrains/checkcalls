// db_setup_profile.js
const sqlite3 = require('sqlite3').verbose();

let db = new sqlite3.Database('./profile.db', (err) => {
  if (err) {
    console.error('Ошибка подключения к базе данных профилей:', err.message);
  } else {
    console.log('Connected to the profile database.');
  }
});

db.serialize(() => {
  // Создаем таблицу user_coins
  db.run(`CREATE TABLE IF NOT EXISTS user_coins (
    user_id INTEGER PRIMARY KEY,
    coins INTEGER DEFAULT 3,
    has_shared_post INTEGER DEFAULT 0
  )`, function(err) {
    if (err) {
      console.error('Error creating user_coins table:', err.message);
    } else {
      console.log('user_coins table created or already exists.');
      // Проверяем наличие столбца hide_me
      db.all("PRAGMA table_info(user_coins);", function(err, columns) {
        if (err) {
          console.error('Error fetching table info for user_coins:', err.message);
        } else {
          const columnNames = columns.map(col => col.name);
          if (!columnNames.includes('hide_me')) {
            db.run(`ALTER TABLE user_coins ADD COLUMN hide_me INTEGER DEFAULT 0`, function(err) {
              if (err) {
                console.error('Error adding hide_me column:', err.message);
              } else {
                console.log('Added hide_me column to user_coins table.');
              }
            });
          } else {
            console.log('hide_me column already exists in user_coins table.');
          }
        }

        // После завершения работы с user_coins переходим к user_achievements
        createUserAchievementsTable();
      });
    }
  });

  function createUserAchievementsTable() {
    // Создаем таблицу user_achievements
    db.run(`CREATE TABLE IF NOT EXISTS user_achievements (
      user_id INTEGER,
      achievement TEXT,
      PRIMARY KEY (user_id, achievement)
    )`, function(err) {
      if (err) {
        console.error('Error creating user_achievements table:', err.message);
      } else {
        console.log('user_achievements table created or already exists.');
        // Проверяем наличие столбца date_obtained
        db.all("PRAGMA table_info(user_achievements);", function(err, columns) {
          if (err) {
            console.error('Error fetching table info for user_achievements:', err.message);
          } else {
            const columnNames = columns.map(col => col.name);
            if (!columnNames.includes('date_obtained')) {
              db.run(`ALTER TABLE user_achievements ADD COLUMN date_obtained TEXT`, function(err) {
                if (err) {
                  console.error('Error adding date_obtained column:', err.message);
                } else {
                  console.log('Added date_obtained column to user_achievements table.');
                }
              });
            } else {
              console.log('date_obtained column already exists in user_achievements table.');
            }
          }

          // После завершения всех операций закрываем базу данных
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
