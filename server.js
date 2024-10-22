// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const port = 3000;

// Включаем CORS для всех маршрутов
app.use(cors());
app.use(express.json());

// Подключение к базам данных
let dbLikes = new sqlite3.Database('./likes.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных лайков:', err.message);
    } else {
        console.log('Connected to the likes database.');
    }
});

let dbStats = new sqlite3.Database('./stats.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных статистики звонков:', err.message);
    } else {
        console.log('Connected to the stats database.');
    }
});

let dbProfile = new sqlite3.Database('./profile.db', (err) => {
    if (err) {
        console.error('Ошибка подключения к базе данных профилей:', err.message);
    } else {
        console.log('Connected to the profile database.');
    }
});

// Замените на ваш реальный публичный ключ для API zvonok.com
const public_key_data = 'c70a62b45ecdd0437dbe5ccae18c6401';

// Маршрут для выполнения звонка
app.post('/proxy-call', async (req, res) => {
    const { phone, campaign_id, max_call_time, audioclip_text, userId, category } = req.body;

    console.log('--- Received /proxy-call request ---');
    console.log('Request body:', req.body);

    // Проверка наличия всех необходимых параметров
    const missingParams = [];
    if (!phone) missingParams.push('phone');
    if (!campaign_id) missingParams.push('campaign_id');
    if (!audioclip_text) missingParams.push('audioclip_text');
    if (!userId) missingParams.push('userId');
    if (!category) missingParams.push('category');

    if (missingParams.length > 0) {
        console.error('Missing required parameters:', missingParams);
        return res.status(400).json({ error: 'Missing parameters: ' + missingParams.join(', ') });
    }

    try {
        // Проверяем, достаточно ли монет у пользователя
        dbProfile.get('SELECT coins FROM user_coins WHERE user_id = ?', [userId], (err, row) => {
            if (err) {
                console.error('Error checking user coins:', err);
                return res.status(500).json({ error: 'Ошибка сервера' });
            }

            let userCoins = row ? row.coins : null;

            if (userCoins === null) {
                // Пользователь не существует, вставляем запись с 3 монетами
                userCoins = 3;
                dbProfile.run('INSERT INTO user_coins (user_id, coins) VALUES (?, ?)', [userId, userCoins], (err) => {
                    if (err) {
                        console.error('Error inserting user coins:', err);
                        return res.status(500).json({ error: 'Ошибка сервера' });
                    }
                    proceedWithCall(userCoins);
                });
            } else {
                proceedWithCall(userCoins);
            }

            function proceedWithCall(userCoins) {
                if (userCoins <= 0) {
                    console.error('Недостаточно монет для совершения звонка у пользователя с ID:', userId);
                    return res.status(400).json({ error: 'Недостаточно монет для совершения звонка' });
                }

                // Уменьшаем количество монет на 1
                dbProfile.run('UPDATE user_coins SET coins = coins - 1 WHERE user_id = ?', [userId], (err) => {
                    if (err) {
                        console.error('Error updating user coins:', err);
                        return res.status(500).json({ error: 'Ошибка сервера' });
                    }

                    // Совершаем звонок
                    makeTheCall();
                });
            }

            function makeTheCall() {
                // Логируем параметры перед отправкой в API
                const apiParams = {
                    public_key: public_key_data,
                    phone: phone,
                    campaign_id: campaign_id,
                    max_call_time: max_call_time || 120,
                    text: audioclip_text,
                };

                console.log('--- Making API call to zvonok.com ---');
                console.log('API Request Params:', apiParams);

                axios.post(
                    'https://zvonok.com/manager/cabapi_external/api/v1/phones/call/',
                    new URLSearchParams(apiParams).toString(),
                    {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                    }
                ).then(response => {
                    console.log('--- Received API response from zvonok.com ---');
                    console.log('API Response Data:', response.data);

                    // Проверяем наличие call_id
                    if (response.data && response.data.call_id) {
                        console.log('call_id found:', response.data.call_id);

                        // Обновляем статистику звонков
                        dbStats.run(
                            `INSERT INTO call_stats (user_id, call_count) VALUES (?, 1)
                                 ON CONFLICT(user_id) DO UPDATE SET call_count = call_count + 1`,
                            [userId],
                            (err) => {
                                if (err) {
                                    console.error('Error updating call stats:', err);
                                } else {
                                    console.log('Call stats updated for userId:', userId);
                                }
                            }
                        );

                        // Обновляем достижения пользователя
                        updateAchievements(userId, category);

                        res.json(response.data);
                    } else {
                        console.error('call_id not found in API response:', response.data);
                        res.status(500).json({ message: 'call_id not found in API response', error: response.data });
                    }
                }).catch(error => {
                    if (error.response) {
                        // API вернул ошибку
                        console.error('--- Error response from zvonok.com ---');
                        console.error('Status:', error.response.status);
                        console.error('Data:', error.response.data);
                        res.status(error.response.status).json({ message: 'Ошибка от API', error: error.response.data });
                    } else if (error.request) {
                        // Запрос был отправлен, но ответ не получен
                        console.error('No response received from API:', error.request);
                        res.status(500).json({ message: 'Нет ответа от API', error: error.message });
                    } else {
                        // Произошла ошибка при настройке запроса
                        console.error('Error setting up API request:', error.message);
                        res.status(500).json({ message: 'Ошибка при настройке запроса к API', error: error.message });
                    }
                });
            }
        });
    } catch (error) {
        console.error('Unexpected error in /proxy-call:', error);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

// Функция для обновления достижений пользователя
function updateAchievements(userId, category) {
    // Получаем общее количество звонков пользователя
    dbStats.get('SELECT call_count FROM call_stats WHERE user_id = ?', [userId], (err, row) => {
        if (err) {
            console.error('Error fetching call count:', err);
            return;
        }

        const totalCalls = row ? row.call_count : 0;
        console.log('Total calls for userId', userId, ':', totalCalls);

        // Список достижений
        const achievementsToCheck = [
            { achievement: 'Первый звонок', condition: totalCalls === 1 },
            { achievement: '3 звонка', condition: totalCalls === 3 },
            { achievement: '10 звонков', condition: totalCalls === 10 },
            { achievement: '100 звонков', condition: totalCalls === 100 },
        ];

        // Категории: звонок девушке, звонок парню
        if (category === 'Девушкам') {
            achievementsToCheck.push({ achievement: 'Звонок девушке', condition: true });
        } else if (category === 'Парням') {
            achievementsToCheck.push({ achievement: 'Звонок парню', condition: true });
        }

        achievementsToCheck.forEach((item) => {
            if (item.condition) {
                const dateObtained = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                dbProfile.run(
                    'INSERT OR IGNORE INTO user_achievements (user_id, achievement, date_obtained) VALUES (?, ?, ?)',
                    [userId, item.achievement, dateObtained],
                    (err) => {
                        if (err) {
                            console.error('Error inserting achievement:', err);
                        } else {
                            console.log('Achievement unlocked for userId', userId, ':', item.achievement);
                        }
                    }
                );
            }
        });

        // Проверка топ 100, топ 10, топ 1 по количеству звонков
        dbStats.all(
            'SELECT user_id, call_count FROM call_stats ORDER BY call_count DESC',
            [],
            (err, rows) => {
                if (err) {
                    console.error('Error fetching call stats:', err);
                    return;
                }

                const userIndex = rows.findIndex((row) => row.user_id === userId);

                if (userIndex !== -1) {
                    if (userIndex === 0) {
                        // Топ 1
                        const dateObtained = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                        dbProfile.run(
                            'INSERT OR IGNORE INTO user_achievements (user_id, achievement, date_obtained) VALUES (?, ?, ?)',
                            [userId, 'Топ 1 по количеству звонков', dateObtained],
                            (err) => {
                                if (err) {
                                    console.error('Error inserting achievement:', err);
                                } else {
                                    console.log('Achievement unlocked for userId', userId, ': Топ 1 по количеству звонков');
                                }
                            }
                        );
                    }
                    if (userIndex < 10) {
                        // Топ 10
                        const dateObtained = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                        dbProfile.run(
                            'INSERT OR IGNORE INTO user_achievements (user_id, achievement, date_obtained) VALUES (?, ?, ?)',
                            [userId, 'Топ 10 по количеству звонков', dateObtained],
                            (err) => {
                                if (err) {
                                    console.error('Error inserting achievement:', err);
                                } else {
                                    console.log('Achievement unlocked for userId', userId, ': Топ 10 по количеству звонков');
                                }
                            }
                        );
                    }
                    if (userIndex < 100) {
                        // Топ 100
                        const dateObtained = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
                        dbProfile.run(
                            'INSERT OR IGNORE INTO user_achievements (user_id, achievement, date_obtained) VALUES (?, ?, ?)',
                            [userId, 'Топ 100 по количеству звонков', dateObtained],
                            (err) => {
                                if (err) {
                                    console.error('Error inserting achievement:', err);
                                } else {
                                    console.log('Achievement unlocked for userId', userId, ': Топ 100 по количеству звонков');
                                }
                            }
                        );
                    }
                }
            }
        );
    });
}

// Обновляем маршрут /api/user-profile/:userId для возврата дат достижений
app.get('/api/user-profile/:userId', (req, res) => {
    const userId = req.params.userId;

    dbProfile.serialize(() => {
        dbProfile.get(
            'SELECT coins, has_shared_post, hide_me FROM user_coins WHERE user_id = ?',
            [userId],
            (err, row) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const coins = row ? row.coins : 3;
                const hasSharedPost = row ? !!row.has_shared_post : false;
                const hideMe = row ? !!row.hide_me : false;

                // Получаем достижения пользователя с датами
                dbProfile.all(
                    'SELECT achievement, date_obtained FROM user_achievements WHERE user_id = ?',
                    [userId],
                    (err, achievementsRows) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }

                        const achievements = achievementsRows.map((row) => ({
                            achievement: row.achievement,
                            date_obtained: row.date_obtained,
                        }));

                        res.json({ coins, achievements, hasSharedPost, hideMe });
                    }
                );
            }
        );
    });
});

// Маршрут для получения даты получения достижения пользователя
app.post('/api/user-achievement-date/:userId', (req, res) => {
    const userId = req.params.userId;
    const { achievement } = req.body;

    dbProfile.get(
        'SELECT date_obtained FROM user_achievements WHERE user_id = ? AND achievement = ?',
        [userId, achievement],
        (err, row) => {
            if (err) {
                console.error('Error fetching achievement date:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
            } else if (row) {
                res.json({ date_obtained: row.date_obtained });
            } else {
                res.json({ date_obtained: null });
            }
        }
    );
});

// Маршрут для получения информации о звонке и записи разговора
app.get('/get-call-info/:call_id', async (req, res) => {
    const { call_id } = req.params;

    console.log('Получение информации о звонке с call_id:', call_id);

    if (!call_id) {
        return res.status(400).json({ message: 'call_id не предоставлен' });
    }

    try {
        const response = await axios.get(
            `https://zvonok.com/manager/cabapi_external/api/v1/phones/call_by_id/`,
            {
                params: {
                    public_key: public_key_data,
                    call_id: call_id,
                    expand: 1,
                },
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        const data = response.data;

        if (response.status === 200 && Array.isArray(data)) {
            const callData = data[0]; // Берем первый элемент массива
            const recordUrl = callData.recorded_audio;

            res.json({
                message: 'Информация о звонке получена',
                call_info: callData,
                record_url: recordUrl,
            });
        } else {
            console.error('Ошибка получения данных:', data);
            res.status(400).json({ message: 'Ошибка получения информации о звонке', data });
        }
    } catch (error) {
        console.error('Ошибка при запросе информации о звонке:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

// Остальные маршруты

// Маршрут для удаления звонка
app.post('/proxy-remove-call', async (req, res) => {
    const { call_id, phone, campaign_id } = req.body;

    try {
        const response = await axios.post(
            'https://zvonok.com/manager/cabapi_external/api/v1/phones/remove_call/',
            new URLSearchParams({
                public_key: public_key_data,
                call_id: call_id,
                phone: phone,
                campaign_id: campaign_id,
            }).toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            }
        );

        res.json(response.data);
    } catch (error) {
        console.error('Ошибка при запросе к API:', error.response ? error.response.data : error.message);
        res.status(500).json({ message: 'Ошибка сервера', error: error.message });
    }
});

// Новый маршрут для скачивания записи
app.get('/download-recording', async (req, res) => {
    try {
        const { url } = req.query;
        if (!url) {
            return res.status(400).send('URL не предоставлен');
        }

        const decodedUrl = decodeURIComponent(url);

        // Проверка, что URL принадлежит домену zvonok.com
        const urlObj = new URL(decodedUrl);
        if (urlObj.hostname !== 'zvonok.com') {
            return res.status(400).send('Недопустимый URL');
        }

        // Используем axios для загрузки записи
        const response = await axios({
            method: 'GET',
            url: decodedUrl,
            responseType: 'stream',
        });

        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Content-Disposition', 'attachment; filename="recording.mp3"');

        response.data.pipe(res);
    } catch (error) {
        console.error('Ошибка при скачивании записи:', error.response ? error.response.data : error.message);
        res.status(500).send('Ошибка при скачивании записи: ' + (error.message || 'Unknown error'));
    }
});

// Маршрут для получения количества лайков для всех аудиоплееров
app.get('/api/likes', (req, res) => {
    const sql = 'SELECT * FROM likes';
    dbLikes.all(sql, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
            return;
        }
        res.json({
            data: rows,
        });
    });
});

// Маршрут для лайка/анлайка аудиоплеера
app.post('/api/likes/:id', (req, res) => {
    const playerId = req.params.id;
    const userId = req.body.userId;

    if (!userId) {
        res.status(400).json({ error: 'User ID is required' });
        return;
    }

    // Проверяем, лайкал ли пользователь этот аудиоплеер
    dbLikes.get(
        'SELECT * FROM user_likes WHERE player_id = ? AND user_id = ?',
        [playerId, userId],
        (err, row) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            if (row) {
                // Пользователь уже лайкал этот аудиоплеер, поэтому удаляем лайк
                dbLikes.run(
                    'DELETE FROM user_likes WHERE player_id = ? AND user_id = ?',
                    [playerId, userId],
                    (err) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }

                        // Уменьшаем количество лайков
                        dbLikes.run(
                            'UPDATE likes SET hearts = hearts - 1 WHERE player_id = ?',
                            [playerId],
                            (err) => {
                                if (err) {
                                    res.status(500).json({ error: err.message });
                                    return;
                                }

                                // Возвращаем обновленное количество лайков
                                dbLikes.get(
                                    'SELECT hearts FROM likes WHERE player_id = ?',
                                    [playerId],
                                    (err, row) => {
                                        if (err) {
                                            res.status(500).json({ error: err.message });
                                            return;
                                        }
                                        res.json({ hearts: row.hearts, liked: false });
                                    }
                                );
                            }
                        );
                    }
                );
            } else {
                // Пользователь не лайкал аудиоплеер, добавляем лайк
                dbLikes.run(
                    'INSERT INTO user_likes (player_id, user_id) VALUES (?, ?)',
                    [playerId, userId],
                    (err) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }

                        // Увеличиваем количество лайков
                        dbLikes.run(
                            'UPDATE likes SET hearts = hearts + 1 WHERE player_id = ?',
                            [playerId],
                            (err) => {
                                if (err) {
                                    res.status(500).json({ error: err.message });
                                    return;
                                }

                                // Возвращаем обновленное количество лайков
                                dbLikes.get(
                                    'SELECT hearts FROM likes WHERE player_id = ?',
                                    [playerId],
                                    (err, row) => {
                                        if (err) {
                                            res.status(500).json({ error: err.message });
                                            return;
                                        }
                                        res.json({ hearts: row.hearts, liked: true });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        }
    );
});

// Маршрут для получения списка аудиоплееров, которые лайкнул пользователь
app.get('/api/user-likes/:userId', (req, res) => {
    const userId = req.params.userId;

    dbLikes.all(
        'SELECT player_id FROM user_likes WHERE user_id = ?',
        [userId],
        (err, rows) => {
            if (err) {
                res.status(500).json({ error: err.message });
                return;
            }

            const likedPlayers = rows.map((row) => row.player_id);
            res.json({ likedPlayers });
        }
    );
});

// Обновление маршрута /api/user-profile/:userId для возврата hasSharedPost
app.get('/api/user-profile/:userId', (req, res) => {
    const userId = req.params.userId;

    dbProfile.serialize(() => {
        dbProfile.get(
            'SELECT coins, has_shared_post FROM user_coins WHERE user_id = ?',
            [userId],
            (err, row) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const coins = row ? row.coins : 3;
                const hasSharedPost = row ? !!row.has_shared_post : false;

                // Получаем достижения пользователя
                dbProfile.all(
                    'SELECT achievement FROM user_achievements WHERE user_id = ?',
                    [userId],
                    (err, achievementsRows) => {
                        if (err) {
                            res.status(500).json({ error: err.message });
                            return;
                        }

                        const achievements = achievementsRows.map((row) => row.achievement);

                        res.json({ coins, achievements, hasSharedPost });
                    }
                );
            }
        );
    });
});

// Маршрут для начисления монет за публикацию (один раз)
app.post('/api/add-coins-for-share', (req, res) => {
    const userId = req.body.userId;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    dbProfile.get(
        'SELECT has_shared_post FROM user_coins WHERE user_id = ?',
        [userId],
        (err, row) => {
            if (err) {
                console.error('Error checking shared post:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                if (row && row.has_shared_post) {
                    res.status(400).json({ error: 'Монета за публикацию уже получена' });
                } else {
                    dbProfile.run(
                        `INSERT INTO user_coins (user_id, coins, has_shared_post) VALUES (?, ?, 1)
                 ON CONFLICT(user_id) DO UPDATE SET coins = coins + 1, has_shared_post = 1`,
                        [userId, 1],
                        (err) => {
                            if (err) {
                                console.error('Error adding coin for share:', err);
                                res.status(500).json({ error: 'Ошибка сервера' });
                            } else {
                                res.json({ message: 'Монета успешно добавлена' });
                            }
                        }
                    );
                }
            }
        }
    );
});

// Маршрут для начисления монет за просмотр рекламы
app.post('/api/add-coins', (req, res) => {
    const userId = req.body.userId;
    const coinsToAdd = req.body.coins || 1;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    dbProfile.run(
        `INSERT INTO user_coins (user_id, coins) VALUES (?, ?)
         ON CONFLICT(user_id) DO UPDATE SET coins = coins + ?`,
        [userId, coinsToAdd, coinsToAdd],
        (err) => {
            if (err) {
                console.error('Error adding coins:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
            } else {
                res.json({ message: 'Монеты успешно добавлены' });
            }
        }
    );
});

// Маршрут для переключения состояния hideMe
app.post('/api/toggle-hide-me', (req, res) => {
    const { userId } = req.body;

    dbProfile.get(
        'SELECT hide_me FROM user_coins WHERE user_id = ?',
        [userId],
        (err, row) => {
            if (err) {
                console.error('Error fetching hide_me:', err);
                res.status(500).json({ error: 'Ошибка сервера' });
                return;
            }

            const newHideMe = row && row.hide_me ? 0 : 1;

            dbProfile.run(
                'UPDATE user_coins SET hide_me = ? WHERE user_id = ?',
                [newHideMe, userId],
                (err) => {
                    if (err) {
                        console.error('Error updating hide_me:', err);
                        res.status(500).json({ error: 'Ошибка сервера' });
                        return;
                    }

                    res.json({ hideMe: !!newHideMe });
                }
            );
        }
    );
});

// Обновляем маршрут /api/top-users для возврата количества звонков и достижений
app.get('/api/top-users', async (req, res) => {
    try {
        dbStats.all(
            `SELECT user_id, call_count FROM call_stats ORDER BY call_count DESC LIMIT 10`,
            [],
            async (err, rows) => {
                if (err) {
                    res.status(500).json({ error: err.message });
                    return;
                }

                const userIds = rows.map((row) => row.user_id);

                // Получаем информацию о том, кто скрывает свои данные
                const hideMeRows = await new Promise((resolve, reject) => {
                    dbProfile.all(
                        'SELECT user_id, hide_me FROM user_coins WHERE user_id IN (' +
                        userIds.map(() => '?').join(',') +
                        ')',
                        userIds,
                        (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows);
                        }
                    );
                });

                // Сопоставляем hideMe
                const hideMeMap = {};
                hideMeRows.forEach((row) => {
                    hideMeMap[row.user_id] = row.hide_me;
                });

                // Получаем достижения пользователей
                const achievementsRows = await new Promise((resolve, reject) => {
                    dbProfile.all(
                        'SELECT user_id, achievement FROM user_achievements WHERE user_id IN (' +
                        userIds.map(() => '?').join(',') +
                        ')',
                        userIds,
                        (err, rows) => {
                            if (err) reject(err);
                            else resolve(rows);
                        }
                    );
                });

                // Сопоставляем достижения
                const achievementsMap = {};
                achievementsRows.forEach((row) => {
                    if (!achievementsMap[row.user_id]) {
                        achievementsMap[row.user_id] = [];
                    }
                    achievementsMap[row.user_id].push(row.achievement);
                });

                // Получаем информацию о пользователях
                const usersInfo = await getUsersInfo(userIds);

                // Сопоставляем информацию
                const topUsers = rows.map((row) => {
                    const userInfo = usersInfo.find((user) => user.id === row.user_id);

                    let name = 'Неизвестный пользователь';
                    let avatar = '';
                    if (hideMeMap[row.user_id]) {
                        // Пользователь скрывает данные
                        name = 'Аноним';
                        avatar = '';
                    } else if (userInfo) {
                        name = `${userInfo.first_name} ${userInfo.last_name}`;
                        avatar = userInfo.photo_100;
                    }

                    return {
                        userId: row.user_id,
                        callCount: row.call_count,
                        name: name,
                        avatar: avatar,
                        achievements: achievementsMap[row.user_id] || [],
                        hideMe: !!hideMeMap[row.user_id], // Добавили информацию о скрытии данных
                    };
                });

                res.json({ topUsers });
            }
        );
    } catch (error) {
        console.error('Error fetching top users:', error);
        res.status(500).json({ error: error.message });
    }
});

// Функция для получения информации о пользователях ВКонтакте
async function getUsersInfo(userIds) {
    // Замените на ваш реальный сервисный ключ доступа
    const accessToken = 'cbce0e99cbce0e99cbce0e99adc8d19ee7ccbcecbce0e99ad3272990dfd32072e53c0b4'; // ВАЖНО: Замените на ваш сервисный ключ доступа
    const fields = 'photo_100';

    try {
        const response = await axios.get('https://api.vk.com/method/users.get', {
            params: {
                user_ids: userIds.join(','),
                fields: fields,
                access_token: accessToken,
                v: '5.131',
            },
        });

        if (response.data.error) {
            throw new Error(response.data.error.error_msg);
        }

        return response.data.response;
    } catch (error) {
        console.error('Ошибка при запросе информации о пользователях VK:', error.response ? error.response.data : error.message);
        return [];
    }
}

app.listen(port, () => {
    console.log(`Proxy server listening at http://localhost:${port}`);
});
