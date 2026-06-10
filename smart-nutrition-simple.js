class SimpleState {
    constructor() {
        this.supabase = null;
        this.currentUser = null;
        this.userData = null;
        this.meals = [];
        this.medicalInfo = [];
        this.mealPlans = [];
        this.weightProgress = [];

        this.initSupabase();
        this.ready = this.loadFromStorage();
    }

    initSupabase() {
        const SUPABASE_URL = window.ENV?.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_ANON_KEY = window.ENV?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            console.error('Supabase credentials not found in environment variables');
            return;
        }
        this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    async loadFromStorage() {
        const theme = localStorage.getItem('theme') || 'dark';
        if (document.body) document.body.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        return this.loadEnvironmentVariables();
    }

    async loadEnvironmentVariables() {
        try {
            const response = await fetch('/api/env');
            if (response.ok) {
                const envVars = await response.json();
                window.ENV = envVars;
                this.initSupabase();
                window.simpleAI = new SimpleAI();
            } else {
                console.error('Failed to load environment variables from API');
            }
        } catch (error) {
            console.error('Error loading environment variables:', error);
        }
    }

    async login(email, password) {
        try {
            if (!this.supabase) return { success: false, error: 'Нет подключения к базе данных' };
            const { data: userData, error: userError } = await this.supabase
                .from('users').select('*').eq('email', email).eq('password_hash', password).single();
            if (userError) {
                if (userError.code === 'PGRST116') return { success: false, error: window.i18n?.t('error_login') || 'Неверный email или пароль' };
                throw userError;
            }
            if (!userData) return { success: false, error: window.i18n?.t('error_login') || 'Неверный email или пароль' };
            this.currentUser = { id: userData.id, email: userData.email };
            this.userData = userData;
            this.saveLocalSession();
            await Promise.allSettled([
                this.loadMedicalInfo(), this.loadMeals(),
                this.loadMealPlans(), this.loadWeightProgress()
            ]);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async register(userData) {
        try {
            const { data: existingUser } = await this.supabase
                .from('users').select('id').eq('email', userData.email).single();
            if (existingUser) return { success: false, error: window.i18n?.t('error_email_used') || 'Этот email уже используется' };
            const { data: newUser, error: userError } = await this.supabase
                .from('users').insert({
                    email: userData.email, password_hash: userData.password,
                    name: userData.name, gender: userData.gender,
                    birth_date: userData.birthDate, height: userData.height,
                    weight: userData.weight, daily_calorie_goal: userData.calorieGoal || 2000,
                    theme: this.currentTheme
                }).select().single();
            if (userError) throw userError;
            this.currentUser = { id: newUser.id, email: newUser.email };
            this.userData = newUser;
            this.saveLocalSession();
            if (userData.weight) {
                await this.addWeightProgress({
                    weight: userData.weight,
                    measured_date: new Date().toISOString().split('T')[0],
                    note: 'Начальный вес'
                });
            }
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async logout() {
        this.currentUser = null; this.userData = null;
        this.meals = []; this.medicalInfo = [];
        this.mealPlans = []; this.weightProgress = [];
        localStorage.removeItem('currentUser');
        localStorage.removeItem('userData');
    }

    async loadMedicalInfo() {
        try {
            const { data, error } = await this.supabase
                .from('medical_info').select('*').eq('user_id', this.currentUser.id);
            if (!error) this.medicalInfo = data || [];
        } catch (e) { console.error('loadMedicalInfo:', e); }
    }

    async loadMeals() {
        try {
            const d = new Date(); d.setDate(d.getDate() - 30);
            const { data, error } = await this.supabase
                .from('meals').select('*').eq('user_id', this.currentUser.id)
                .gte('meal_date', d.toISOString().split('T')[0])
                .order('meal_date', { ascending: false })
                .order('created_at', { ascending: false });
            if (!error) this.meals = data || [];
        } catch (e) { console.error('loadMeals:', e); }
    }

    async loadMealPlans() {
        try {
            const d = new Date(); d.setDate(d.getDate() - 30);
            const { data, error } = await this.supabase
                .from('meal_plans').select('*').eq('user_id', this.currentUser.id)
                .gte('plan_date', d.toISOString().split('T')[0])
                .order('plan_date', { ascending: false });
            if (!error) this.mealPlans = data || [];
        } catch (e) { console.error('loadMealPlans:', e); }
    }

    async loadWeightProgress() {
        try {
            const { data, error } = await this.supabase
                .from('weight_progress').select('*').eq('user_id', this.currentUser.id)
                .order('measured_date', { ascending: false }).limit(30);
            if (!error) this.weightProgress = data || [];
        } catch (e) { console.error('loadWeightProgress:', e); }
    }

    async updateUserData(updates) {
        try {
            const { data, error } = await this.supabase
                .from('users').update(updates).eq('id', this.currentUser.id).select().single();
            if (error) throw error;
            this.userData = { ...this.userData, ...data };
            this.saveLocalSession();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addMedicalInfo(medicalData) {
        try {
            const { data, error } = await this.supabase
                .from('medical_info').insert({ user_id: this.currentUser.id, ...medicalData }).select().single();
            if (error) throw error;
            this.medicalInfo.push(data);
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteMedicalInfo(id) {
        try {
            const { error } = await this.supabase
                .from('medical_info').delete().eq('id', id).eq('user_id', this.currentUser.id);
            if (error) throw error;
            this.medicalInfo = this.medicalInfo.filter(item => item.id !== id);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addMeal(mealData) {
        try {
            const { data, error } = await this.supabase
                .from('meals').insert({ user_id: this.currentUser.id, ...mealData }).select().single();
            if (error) throw error;
            this.meals.unshift(data);
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async deleteMeal(id) {
        try {
            const { error } = await this.supabase
                .from('meals').delete().eq('id', id).eq('user_id', this.currentUser.id);
            if (error) throw error;
            this.meals = this.meals.filter(m => m.id !== id);
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async saveMealPlan(planData) {
        try {
            const existingPlan = this.mealPlans.find(p => p.plan_date === planData.plan_date);
            let data, error;
            if (existingPlan) {
                const result = await this.supabase.from('meal_plans')
                    .update(planData).eq('id', existingPlan.id).select().single();
                data = result.data; error = result.error;
            } else {
                const result = await this.supabase.from('meal_plans')
                    .insert({ user_id: this.currentUser.id, ...planData }).select().single();
                data = result.data; error = result.error;
            }
            if (error) throw error;
            const idx = this.mealPlans.findIndex(p => p.plan_date === planData.plan_date);
            if (idx >= 0) this.mealPlans[idx] = data;
            else this.mealPlans.unshift(data);
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async addWeightProgress(weightData) {
        try {
            const { data, error } = await this.supabase
                .from('weight_progress').insert({ user_id: this.currentUser.id, ...weightData }).select().single();
            if (error) throw error;
            this.weightProgress.unshift(data);
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    getTodayMeals() {
        const today = new Date().toISOString().split('T')[0];
        return this.meals.filter(meal => meal.meal_date === today);
    }

    getTodayStats() {
        return this.getTodayMeals().reduce(
            (s, m) => ({
                calories: s.calories + (m.calories || 0),
                protein:  s.protein  + (m.protein  || 0),
                fat:      s.fat      + (m.fat      || 0),
                carbs:    s.carbs    + (m.carbs    || 0)
            }),
            { calories: 0, protein: 0, fat: 0, carbs: 0 }
        );
    }

    getMealsForDate(date)    { return this.meals.filter(m => m.meal_date === date); }
    getMealPlanForDate(date) { return this.mealPlans.find(p => p.plan_date === date); }

    getWeightChange(days = 7) {
        const weights = this.weightProgress.slice(0, days).map(w => w.weight);
        if (weights.length < 2) return null;
        return weights[0] - weights[weights.length - 1];
    }

    getWeightTrend() {
        if (this.weightProgress.length < 2) return null;
        const weights = this.weightProgress.slice(0, 7).map(w => w.weight);
        const change  = weights[0] - weights[weights.length - 1];
        return { change, trend: change > 0 ? 'up' : change < 0 ? 'down' : 'stable' };
    }

    async updateTheme(theme) {
        this.currentTheme = theme;
        localStorage.setItem('theme', theme);
        if (document.body) document.body.setAttribute('data-theme', theme);
        if (this.userData) await this.updateUserData({ theme });
    }

    checkLocalSession() {
        const saved = localStorage.getItem('currentUser');
        if (saved) {
            try {
                this.currentUser = JSON.parse(saved);
                this.loadUserDataFromStorage();
                return true;
            } catch { localStorage.removeItem('currentUser'); }
        }
        return false;
    }

    saveLocalSession() {
        if (this.currentUser) {
            localStorage.setItem('currentUser', JSON.stringify(this.currentUser));
            localStorage.setItem('userData',    JSON.stringify(this.userData));
        }
    }

    loadUserDataFromStorage() {
        const saved = localStorage.getItem('userData');
        if (saved) {
            try { this.userData = JSON.parse(saved); }
            catch { console.error('Error parsing userData'); }
        }
    }
}

// ════════════════════════════════════════════════════════════════
// I18N
// ════════════════════════════════════════════════════════════════

class I18n {
    constructor() {
        this.lang = localStorage.getItem('lang') || 'ru';
        this.translations = {
            ru: {
                // Auth
                welcome: 'Умный контроль питания',
                login: 'Войти',
                register: 'Регистрация',
                email: 'Email',
                password: 'Пароль',
                name: 'Имя',
                your_name: 'Ваше имя',
                gender: 'Пол',
                male: 'Мужской',
                female: 'Женский',
                birth_date: 'Дата рождения',
                height_cm: 'Рост (см)',
                weight_kg: 'Вес (кг)',
                calorie_goal: 'Цель калорий / день',
                sign_in: 'Войти',
                sign_up: 'Зарегистрироваться',
                signing_in: '…',
                welcome_back: 'Добро пожаловать!',
                registered: 'Регистрация успешна!',
                error_login: 'Неверный email или пароль',
                error_email_used: 'Этот email уже используется',
                // Nav
                nav_home: 'Главная',
                nav_add: 'Добавить',
                nav_plan: 'План',
                nav_profile: 'Профиль',
                // Home
                greeting: 'Привет',
                of_kcal: 'из',
                kcal: 'ккал',
                daily_progress: 'Дневной прогресс',
                over_kcal: 'ккал превышение',
                left_kcal: 'ккал осталось',
                protein: 'Белки',
                fat: 'Жиры',
                carbs: 'Углеводы',
                today: 'Сегодня',
                records: 'записей',
                no_meals: 'Нет записей за сегодня',
                add_meal_btn: 'Добавить приём',
                weight_down: '↓ Вес снижается',
                weight_up: '↑ Вес растёт',
                weight_stable: '→ Вес стабилен',
                days7: 'за 7 дней',
                // Add meal
                new_meal: 'Новый приём пищи',
                meal_name: 'Название блюда',
                meal_placeholder: 'Напр. Овсянка с ягодами',
                category: 'Категория',
                breakfast: 'Завтрак',
                lunch: 'Обед',
                dinner: 'Ужин',
                snack: 'Перекус',
                calories: 'Калории (ккал)',
                weight: 'Вес (г)',
                after_add: 'После добавления:',
                add_meal_submit: 'Добавить приём',
                adding: 'Сохраняем…',
                ai_photo: 'AI Анализ фото',
                photo_hint: 'Сфотографируйте блюдо',
                photo_sub: 'AI определит калории автоматически',
                analyzing: '🤖 Анализирую изображение…',
                recognized: '✅ Распознано:',
                photo_filled: 'Данные из фото заполнены',
                meal_added: 'Приём пищи добавлен ✓',
                deleted: 'Удалено ✓',
                // Plan
                meal_plan: 'План питания',
                generate: 'Сгенерировать',
                today_date: 'на сегодня',
                total_kcal: 'итого ккал',
                recommendations: 'Рекомендации',
                no_plan: 'План на сегодня ещё не создан',
                generate_plan: 'Сгенерировать план',
                generating: 'Генерирую план питания…',
                plan_generated: 'План сгенерирован! ✓',
                plan_saved: 'План сохранён ✓',
                plan_error: 'Ошибка генерации',
                plan_history: 'История планов',
                history_date: 'Дата',
                history_calories: 'Калории',
                view: 'Смотреть',
                analyze_week: 'Анализ последней недели',
                weekly_analysis_title: 'Анализ недели',
                current_weight_prompt: 'Текущий вес (кг)',
                weekly_analysis_description: 'AI изучит ваши последние 7 дней, калории и сравнит вес с текущим профилем.',
                analysis_action: 'Анализировать',
                analysis_no_weight: 'Введите корректный вес',
                weekly_analysis_note: 'Анализ недели',
                analysis_failed: 'Не удалось провести анализ',
                analysis_default_message: 'Ваш недельный анализ готов.',
                analysis_changed_weight: 'Новый вес: {weight} кг. Изменение: {diff} кг.',
                suggested_calorie_goal: 'Рекомендуемая цель: {goal} ккал.',
                close: 'Закрыть',
                // Profile
                profile: 'Профиль',
                personal_data: 'Личные данные',
                save_changes: 'Сохранить изменения',
                weight_note: 'При изменении веса он запишется в историю прогресса',
                medical_data: 'Медицинские данные',
                add_medical: 'Добавить',
                no_medical: 'Нет медицинских данных',
                settings: 'Настройки',
                theme: 'Тема',
                theme_dark: 'Тёмная',
                theme_light: 'Светлая',
                language: 'Язык',
                data_updated: 'Данные обновлены ✓',
                weight_saved: 'Вес записан ✓',
                // Medical modal
                add_med_title: 'Добавить медданные',
                med_name: 'Название',
                med_name_placeholder: 'Напр. Аллергия на орехи',
                med_type: 'Тип',
                disease: 'Заболевание',
                allergy: 'Аллергия',
                intolerance: 'Непереносимость',
                severity: 'Тяжесть',
                mild: 'Лёгкая',
                moderate: 'Средняя',
                severe: 'Тяжёлая',
                description: 'Описание (необязательно)',
                desc_placeholder: 'Дополнительная информация',
                add_btn: 'Добавить',
                cancel: 'Отмена',
                med_added: 'Добавлено ✓',
                med_deleted: 'Запись удалена',
                confirm_delete: 'Удалить эту запись?',
                confirm_logout: 'Выйти из аккаунта?',
                // AI lang hint
                ai_lang: 'ru',
                ai_lang_name: 'русском',
            },
            kz: {
                welcome: 'Ақылды тамақтану бақылауы',
                login: 'Кіру',
                register: 'Тіркелу',
                email: 'Email',
                password: 'Құпия сөз',
                name: 'Аты',
                your_name: 'Атыңыз',
                gender: 'Жынысы',
                male: 'Еркек',
                female: 'Әйел',
                birth_date: 'Туған күні',
                height_cm: 'Бойы (см)',
                weight_kg: 'Салмағы (кг)',
                calorie_goal: 'Күндік калория мақсаты',
                sign_in: 'Кіру',
                sign_up: 'Тіркелу',
                signing_in: '…',
                welcome_back: 'Қош келдіңіз!',
                registered: 'Тіркелу сәтті!',
                error_login: 'Email немесе құпия сөз қате',
                error_email_used: 'Бұл email тіркелген',
                nav_home: 'Басты',
                nav_add: 'Қосу',
                nav_plan: 'Жоспар',
                nav_profile: 'Профиль',
                greeting: 'Сәлем',
                of_kcal: '/',
                kcal: 'ккал',
                daily_progress: 'Күндік прогресс',
                over_kcal: 'ккал асып кетті',
                left_kcal: 'ккал қалды',
                protein: 'Ақуыз',
                fat: 'Май',
                carbs: 'Көмірсу',
                today: 'Бүгін',
                records: 'жазба',
                no_meals: 'Бүгін жазба жоқ',
                add_meal_btn: 'Тамақ қосу',
                weight_down: '↓ Салмақ азаюда',
                weight_up: '↑ Салмақ өсуде',
                weight_stable: '→ Салмақ тұрақты',
                days7: '7 күн ішінде',
                new_meal: 'Жаңа тамақ',
                meal_name: 'Тамақ атауы',
                meal_placeholder: 'Мыс. Жеміспен сұлы',
                category: 'Санат',
                breakfast: 'Таңғы ас',
                lunch: 'Түскі ас',
                dinner: 'Кешкі ас',
                snack: 'Тағам',
                calories: 'Калория (ккал)',
                weight: 'Салмақ (г)',
                after_add: 'Қосқаннан кейін:',
                add_meal_submit: 'Тамақ қосу',
                adding: 'Сақталуда…',
                ai_photo: 'AI Фото талдауы',
                photo_hint: 'Тамақты суретке түсіріңіз',
                photo_sub: 'AI калорияны автоматты анықтайды',
                analyzing: '🤖 Сурет талдануда…',
                recognized: '✅ Анықталды:',
                photo_filled: 'Деректер фотодан толтырылды',
                meal_added: 'Тамақ қосылды ✓',
                deleted: 'Жойылды ✓',
                meal_plan: 'Тамақтану жоспары',
                generate: 'Жасау',
                today_date: 'бүгінге',
                total_kcal: 'жалпы ккал',
                recommendations: 'Ұсыныстар',
                no_plan: 'Бүгінге жоспар жоқ',
                generate_plan: 'Жоспар жасау',
                generating: 'Тамақтану жоспары жасалуда…',
                plan_generated: 'Жоспар жасалды! ✓',
                plan_saved: 'Жоспар сақталды ✓',
                plan_error: 'Жасау қатесі',
                plan_history: 'Жоспар тарихы',
                history_date: 'Күні',
                history_calories: 'Калория',
                view: 'Көру',
                analyze_week: 'Апталық талдау',
                weekly_analysis_title: 'Апталық талдау',
                current_weight_prompt: 'Қазіргі салмақ (кг)',
                weekly_analysis_description: 'AI соңғы 7 күнді, калорияларды және салмақты салыстырады.',
                analysis_action: 'Талдау',
                analysis_no_weight: 'Дұрыс салмақты енгізіңіз',
                weekly_analysis_note: 'Апталық талдау',
                analysis_failed: 'Талдауды орындау мүмкін болмады',
                analysis_default_message: 'Апталық талдау дайын.',
                analysis_changed_weight: 'Жаңа салмақ: {weight} кг. Өзгеріс: {diff} кг.',
                suggested_calorie_goal: 'Ұсынылатын мақсат: {goal} ккал.',
                close: 'Жабу',
                profile: 'Профиль',
                personal_data: 'Жеке деректер',
                save_changes: 'Өзгерістерді сақтау',
                weight_note: 'Салмақты өзгерту оны прогресс тарихына жазады',
                medical_data: 'Медициналық деректер',
                add_medical: 'Қосу',
                no_medical: 'Медициналық деректер жоқ',
                settings: 'Параметрлер',
                theme: 'Тақырып',
                theme_dark: 'Күңгірт',
                theme_light: 'Жарық',
                language: 'Тіл',
                data_updated: 'Деректер жаңартылды ✓',
                weight_saved: 'Салмақ жазылды ✓',
                add_med_title: 'Медициналық деректер қосу',
                med_name: 'Атауы',
                med_name_placeholder: 'Мыс. Жаңғаққа аллергия',
                med_type: 'Түрі',
                disease: 'Ауру',
                allergy: 'Аллергия',
                intolerance: 'Төзбеушілік',
                severity: 'Ауырлық',
                mild: 'Жеңіл',
                moderate: 'Орташа',
                severe: 'Ауыр',
                description: 'Сипаттама (міндетті емес)',
                desc_placeholder: 'Қосымша ақпарат',
                add_btn: 'Қосу',
                cancel: 'Болдырмау',
                med_added: 'Қосылды ✓',
                med_deleted: 'Жазба жойылды',
                confirm_delete: 'Бұл жазбаны жою керек пе?',
                confirm_logout: 'Шыққыңыз келе ме?',
                ai_lang: 'kz',
                ai_lang_name: 'казахском',
            },
            en: {
                welcome: 'Smart Nutrition Control',
                login: 'Log In',
                register: 'Sign Up',
                email: 'Email',
                password: 'Password',
                name: 'Name',
                your_name: 'Your name',
                gender: 'Gender',
                male: 'Male',
                female: 'Female',
                birth_date: 'Date of Birth',
                height_cm: 'Height (cm)',
                weight_kg: 'Weight (kg)',
                calorie_goal: 'Daily Calorie Goal',
                sign_in: 'Log In',
                sign_up: 'Create Account',
                signing_in: '…',
                welcome_back: 'Welcome back!',
                registered: 'Registration successful!',
                error_login: 'Invalid email or password',
                error_email_used: 'This email is already in use',
                nav_home: 'Home',
                nav_add: 'Add',
                nav_plan: 'Plan',
                nav_profile: 'Profile',
                greeting: 'Hey',
                of_kcal: 'of',
                kcal: 'kcal',
                daily_progress: 'Daily Progress',
                over_kcal: 'kcal over',
                left_kcal: 'kcal left',
                protein: 'Protein',
                fat: 'Fat',
                carbs: 'Carbs',
                today: 'Today',
                records: 'entries',
                no_meals: 'No entries today',
                add_meal_btn: 'Add Meal',
                weight_down: '↓ Weight decreasing',
                weight_up: '↑ Weight increasing',
                weight_stable: '→ Weight stable',
                days7: 'over 7 days',
                new_meal: 'New Meal Entry',
                meal_name: 'Dish name',
                meal_placeholder: 'e.g. Oatmeal with berries',
                category: 'Category',
                breakfast: 'Breakfast',
                lunch: 'Lunch',
                dinner: 'Dinner',
                snack: 'Snack',
                calories: 'Calories (kcal)',
                weight: 'Weight (g)',
                after_add: 'After adding:',
                add_meal_submit: 'Add Meal',
                adding: 'Saving…',
                ai_photo: 'AI Photo Analysis',
                photo_hint: 'Take a photo of your meal',
                photo_sub: 'AI will detect calories automatically',
                analyzing: '🤖 Analyzing image…',
                recognized: '✅ Recognized:',
                photo_filled: 'Fields filled from photo',
                meal_added: 'Meal added ✓',
                deleted: 'Deleted ✓',
                meal_plan: 'Meal Plan',
                generate: 'Generate',
                today_date: 'for today',
                total_kcal: 'total kcal',
                recommendations: 'Recommendations',
                no_plan: 'No plan for today yet',
                generate_plan: 'Generate Plan',
                generating: 'Generating meal plan…',
                plan_generated: 'Plan generated! ✓',
                plan_saved: 'Plan saved ✓',
                plan_error: 'Generation error',
                plan_history: 'Plan history',
                history_date: 'Date',
                history_calories: 'Calories',
                view: 'View',
                analyze_week: 'Analyze last week',
                weekly_analysis_title: 'Weekly analysis',
                current_weight_prompt: 'Current weight (kg)',
                weekly_analysis_description: 'AI will review your last 7 days, calories and compare weight to profile.',
                analysis_action: 'Analyze',
                analysis_no_weight: 'Enter a valid weight',
                weekly_analysis_note: 'Weekly analysis',
                analysis_failed: 'Could not complete analysis',
                analysis_default_message: 'Weekly analysis is ready.',
                analysis_changed_weight: 'New weight: {weight} kg. Change: {diff} kg.',
                suggested_calorie_goal: 'Suggested goal: {goal} kcal.',
                close: 'Close',
                profile: 'Profile',
                personal_data: 'Personal Data',
                save_changes: 'Save Changes',
                weight_note: 'Changing weight will record it in progress history',
                medical_data: 'Medical Data',
                add_medical: 'Add',
                no_medical: 'No medical data',
                settings: 'Settings',
                theme: 'Theme',
                theme_dark: 'Dark',
                theme_light: 'Light',
                language: 'Language',
                data_updated: 'Data updated ✓',
                weight_saved: 'Weight saved ✓',
                add_med_title: 'Add Medical Info',
                med_name: 'Name',
                med_name_placeholder: 'e.g. Nut allergy',
                med_type: 'Type',
                disease: 'Disease',
                allergy: 'Allergy',
                intolerance: 'Intolerance',
                severity: 'Severity',
                mild: 'Mild',
                moderate: 'Moderate',
                severe: 'Severe',
                description: 'Description (optional)',
                desc_placeholder: 'Additional information',
                add_btn: 'Add',
                cancel: 'Cancel',
                med_added: 'Added ✓',
                med_deleted: 'Record deleted',
                confirm_delete: 'Delete this record?',
                confirm_logout: 'Log out of account?',
                ai_lang: 'en',
                ai_lang_name: 'English',
            }
        };
    }

    t(key) {
        return this.translations[this.lang]?.[key] ?? this.translations['ru']?.[key] ?? key;
    }

    setLang(lang) {
        this.lang = lang;
        localStorage.setItem('lang', lang);
    }

    getLang() { return this.lang; }
}

// ════════════════════════════════════════════════════════════════
// AI
// ════════════════════════════════════════════════════════════════

class SimpleAI {
    constructor() {
        this.apiKey = window.ENV?.NEXT_PUBLIC_GEMINI_API_KEY;
        this.models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest'];
        if (!this.apiKey) console.error('Gemini API key not found in environment variables');
    }

    static stripMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/#{1,6}\s*/g, '').replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1').replace(/^[\-\*]\s+/gm, '• ')
            .replace(/`(.+?)`/g, '$1').trim();
    }

    async _callAPI(model, body) {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            throw Object.assign(new Error(`API ${res.status}: ${errText.slice(0, 150)}`), { status: res.status });
        }
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) throw new Error('Empty AI response');
        const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI did not return JSON: ' + clean.slice(0, 200));
        return JSON.parse(match[0]);
    }

    async _withFallback(makeBody) {
        let lastErr;
        for (const model of this.models) {
            try { return await this._callAPI(model, makeBody(model)); }
            catch (err) {
                console.warn(`[AI] ${model} failed:`, err.message);
                lastErr = err;
                if (err.status === 400 || err.status === 403) break;
            }
        }
        throw lastErr;
    }

    _getLangInstruction() {
        const lang = window.i18n?.getLang() || 'ru';
        if (lang === 'kz') return 'Respond in Kazakh language (қазақ тілінде жауап бер). All dish names and recommendations must be in Kazakh.';
        if (lang === 'en') return 'Respond in English. All dish names and recommendations must be in English.';
        return 'Respond in Russian language. All dish names and recommendations must be in Russian.';
    }

    async analyzeImage(imageBase64, medicalInfo = []) {
        const restrictionText = medicalInfo.length > 0
            ? `Important: user has ${medicalInfo.map(m => `${m.name} (${m.info_type}, ${m.severity})`).join(', ')}. Avoid any ingredient or dish that can trigger these conditions.`
            : '';
        const langInstr = this._getLangInstruction();

        return this._withFallback((_m) => ({
            contents: [{
                parts: [
                    { text: `You are a dietitian. Analyze the food photo and return ONLY valid JSON without markdown.\n${langInstr}\n${restrictionText}\nFormat: {"name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"weight":0,"category":"breakfast","warnings":[]}\nIf no food found: {"error":"Food not found in photo"}` },
                    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
                ]
            }]
        }));
    }

    async generateMealPlan(userData, medicalInfo = [], previousDaysData = []) {
        const goal = userData?.daily_calorie_goal || 2000;
        const restrictions = medicalInfo
            .filter(m => ['allergy', 'intolerance'].includes(m.info_type))
            .map(m => m.name)
            .filter(Boolean);
        const restrictionText = restrictions.length > 0
            ? `Avoid all foods and ingredients related to: ${restrictions.join(', ')}. Do not suggest anything that may contain these allergens or intolerances.`
            : '';
        const medCtx = medicalInfo.length > 0
            ? `Medical conditions: ${medicalInfo.map(m => `${m.name} (${m.severity}, ${m.info_type})`).join(', ')}. ${restrictionText}`
            : '';
        const langInstr = this._getLangInstruction();

        const prompt = `Create a one-day meal plan. ${langInstr}
User: ${userData?.name || 'User'}, age ${this.calcAge(userData?.birth_date)}, ${userData?.gender || 'unknown'}, height ${userData?.height || '?'}cm, weight ${userData?.weight || '?'}kg, goal ${goal} kcal/day. ${medCtx}
Return ONLY valid JSON without markdown:
{"breakfast":{"name":"...","calories":400,"protein":15,"fat":10,"carbs":65},"lunch":{"name":"...","calories":500,"protein":40,"fat":20,"carbs":45},"dinner":{"name":"...","calories":450,"protein":35,"fat":15,"carbs":50},"snack":{"name":"...","calories":150,"protein":5,"fat":8,"carbs":25},"recommendations":["...","..."],"adjustments":"..."}`;

        try {
            const response = await this._withFallback(() => ({ contents: [{ parts: [{ text: prompt }] }] }));
            let jsonText = typeof response === 'object' ? JSON.stringify(response) : response;
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON in AI response');
            const plan = JSON.parse(jsonMatch[0]);
            const planText = JSON.stringify(plan).toLowerCase();
            if (restrictions.some(term => term && planText.includes(term.toLowerCase()))) {
                throw new Error('AI generated plan contains restricted food items');
            }
            plan.total_calories = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.calories||0), 0);
            plan.total_protein  = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.protein||0), 0);
            plan.total_fat      = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.fat||0), 0);
            plan.total_carbs    = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.carbs||0), 0);
            return plan;
        } catch (error) {
            console.error('Meal plan generation failed:', error);
            const lang = window.i18n?.getLang() || 'ru';
            const breakfastCal = Math.round(goal * 0.25);
            const lunchCal = Math.round(goal * 0.35);
            const dinnerCal = Math.round(goal * 0.30);
            const snackCal = goal - breakfastCal - lunchCal - dinnerCal;

            const fallbacks = {
                ru: { b:'Омлет с овощами', l:'Куриный салат', d:'Запечённая рыба с брокколи', s:'Фрукты и орехи', r:['Пейте больше воды', 'Снизьте потребление сахара'] },
                kz: { b:'Көкөністері бар омлет', l:'Тауық еті салаты', d:'Брокколиге қосылған балық', s:'Жеміс пен жаңғақ', r:['Көбірек су ішіңіз', 'Қант тұтынуды азайтыңыз'] },
                en: { b:'Vegetable omelette', l:'Chicken salad', d:'Baked fish with vegetables', s:'Fruits and nuts', r:['Drink more water', 'Reduce sugar intake'] },
            };
            const fb = fallbacks[lang] || fallbacks.ru;

            return {
                breakfast: { name: fb.b, calories: breakfastCal, protein: Math.round(breakfastCal*0.15/4), fat: Math.round(breakfastCal*0.25/9), carbs: Math.round(breakfastCal*0.60/4) },
                lunch:     { name: fb.l, calories: lunchCal,     protein: Math.round(lunchCal*0.35/4),     fat: Math.round(lunchCal*0.30/9),     carbs: Math.round(lunchCal*0.35/4) },
                dinner:    { name: fb.d, calories: dinnerCal,    protein: Math.round(dinnerCal*0.40/4),    fat: Math.round(dinnerCal*0.30/9),    carbs: Math.round(dinnerCal*0.30/4) },
                snack:     { name: fb.s, calories: snackCal,     protein: Math.round(snackCal*0.10/4),     fat: Math.round(snackCal*0.40/9),     carbs: Math.round(snackCal*0.50/4) },
                recommendations: fb.r,
                adjustments: `Goal: ${goal} kcal`,
                total_calories: goal,
                total_protein: Math.round(goal*0.25/4),
                total_fat:     Math.round(goal*0.30/9),
                total_carbs:   Math.round(goal*0.45/4)
            };
        }
    }

    async analyzeWeeklyProgress(currentWeight, weeklyMeals, userData, medicalInfo = []) {
        const startWeight = userData?.weight || currentWeight;
        const goal = userData?.daily_calorie_goal || 2000;
        const restrictions = medicalInfo
            .filter(m => ['allergy', 'intolerance'].includes(m.info_type))
            .map(m => m.name)
            .filter(Boolean);
        const restrictionText = restrictions.length
            ? `Avoid foods and ingredients related to: ${restrictions.join(', ')}.`
            : '';
        const mealLines = weeklyMeals.map(day => {
            const total = day.meals.reduce((sum, meal) => sum + (meal.calories || 0), 0);
            const names = day.meals.map(meal => meal.name).filter(Boolean).join(', ') || 'no meals';
            return `${day.date}: ${total} kcal, ${names}`;
        }).join('\n');

        const langInstr = this._getLangInstruction();
        const prompt = `${langInstr}\nYou are a nutrition coach. The user started the week at ${startWeight} kg and now reports ${currentWeight} kg. Current daily calorie goal: ${goal} kcal. ${restrictionText}\nReview these last 7 days of meals and calories exactly as given. Return ONLY valid JSON without markdown using keys: message, recommendations, suggested_calorie_goal.\nWeekly meals summary:\n${mealLines}\nIf weight increased, recommend a stronger diet and lower the calorie goal moderately. If weight decreased, congratulate and keep or adjust the goal. If weight is stable, suggest maintaining the plan with small improvements.\nAlways respond only in the requested language.`;

        try {
            const response = await this._withFallback(() => ({ contents: [{ parts: [{ text: prompt }] }] }));
            const jsonText = typeof response === 'object' ? JSON.stringify(response) : response;
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON in AI response');
            return JSON.parse(jsonMatch[0]);
        } catch (error) {
            console.error('Weekly analysis failed:', error);
            const lang = window.i18n?.getLang() || 'ru';
            const delta = Number((currentWeight - startWeight).toFixed(2));
            const messages = {
                ru: {
                    message: delta < 0
                        ? `Вы сбросили ${Math.abs(delta).toFixed(1)} кг за неделю.`
                        : delta > 0
                            ? `Вы набрали ${delta.toFixed(1)} кг за неделю.`
                            : 'Вес остался стабильным за неделю.',
                    recommendations: delta > 0.3
                        ? ['Уменьшите калорийность на 150–200 ккал.', 'Добавьте больше белка и овощей.', 'Увеличьте физическую активность.']
                        : delta < -0.3
                            ? ['Продолжайте текущий режим.', 'Соблюдайте баланс белка и воды.', 'Поддерживайте цель по калориям.']
                            : ['Вес стабилен — продолжайте наблюдать.', 'Сбалансируйте питание и активность.'],
                    suggested_goal: delta > 0.3 ? Math.max(1200, goal - 150) : goal
                },
                kz: {
                    message: delta < 0
                        ? `Сіз аптасына ${Math.abs(delta).toFixed(1)} кг жоғалттыңыз.`
                        : delta > 0
                            ? `Сіз аптасына ${delta.toFixed(1)} кг жинадыңыз.`
                            : 'Салмақ тұрақты қалды.',
                    recommendations: delta > 0.3
                        ? ['Калорияны 150–200 ккалға азайтыңыз.', 'Көп ақуыз бен көкөніс қосыңыз.', 'Физикалық белсенділікті арттырыңыз.']
                        : delta < -0.3
                            ? ['Қазіргі режимді жалғастырыңыз.', 'Ақуыз бен судың тепе-теңдігін сақтаңыз.', 'Калория мақсатын ұстап тұрыңыз.']
                            : ['Салмақ тұрақты — бақылауды жалғастырыңыз.', 'Тамақ пен белсенділікті теңгеріңіз.'],
                    suggested_goal: delta > 0.3 ? Math.max(1200, goal - 150) : goal
                },
                en: {
                    message: delta < 0
                        ? `You lost ${Math.abs(delta).toFixed(1)} kg this week.`
                        : delta > 0
                            ? `You gained ${delta.toFixed(1)} kg this week.`
                            : 'Your weight remained stable this week.',
                    recommendations: delta > 0.3
                        ? ['Reduce calories by 150–200 kcal.', 'Add more protein and vegetables.', 'Increase physical activity.']
                        : delta < -0.3
                            ? ['Continue the current routine.', 'Keep protein and hydration balanced.', 'Maintain your calorie target.']
                            : ['Weight is stable — keep monitoring.', 'Balance your meals and activity.'],
                    suggested_goal: delta > 0.3 ? Math.max(1200, goal - 150) : goal
                }
            };
            const fallback = messages[lang] || messages.ru;
            return {
                message: fallback.message,
                recommendations: fallback.recommendations,
                suggested_calorie_goal: fallback.suggested_goal
            };
        }
    }

    calcAge(birthDate) {
        if (!birthDate) return 30;
        return Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25*24*60*60*1000));
    }
}

// ════════════════════════════════════════════════════════════════
// GLOBAL INSTANCES
// ════════════════════════════════════════════════════════════════

window.i18n        = new I18n();
window.simpleState = new SimpleState();
window.simpleAI    = null;

window.showToast = window.showToast || function(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) { console.log(`[${type}]`, msg); return; }
    const el   = document.createElement('div');
    const col  = type === 'success' ? '#15803d' : type === 'error' ? '#b91c1c' : '#1d4ed8';
    el.style.cssText = `background:${col};color:#fff;padding:.6rem 1rem;border-radius:8px;margin-bottom:6px;font-size:.875rem;box-shadow:0 4px 14px rgba(0,0,0,.3);animation:slideUp .3s ease`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => {
        el.style.cssText += ';opacity:0;transform:translateX(110%);transition:all .35s';
        setTimeout(() => el.remove(), 360);
    }, 3200);
};

window.addMeal = async (d) => {
    const r = await window.simpleState.addMeal(d);
    window.showToast(r.success ? window.i18n.t('meal_added') : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.deleteMeal = async (id) => {
    const r = await window.simpleState.deleteMeal(id);
    window.showToast(r.success ? window.i18n.t('deleted') : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.addMedicalInfo = async (d) => {
    const r = await window.simpleState.addMedicalInfo(d);
    window.showToast(r.success ? window.i18n.t('med_added') : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.updateUserData = async (updates) => {
    const r = await window.simpleState.updateUserData(updates);
    window.showToast(r.success ? window.i18n.t('data_updated') : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.saveMealPlan = async (d) => {
    const r = await window.simpleState.saveMealPlan(d);
    window.showToast(r.success ? window.i18n.t('plan_saved') : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.addWeightProgress = async (d) => {
    const r = await window.simpleState.addWeightProgress(d);
    window.showToast(r.success ? window.i18n.t('weight_saved') : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};

console.log('✅ Smart Nutrition JS loaded (i18n enabled)');