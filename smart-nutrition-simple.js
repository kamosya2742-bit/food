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
        this.loadFromStorage();
    }

    initSupabase() {
        const SUPABASE_URL = window.ENV?.NEXT_PUBLIC_SUPABASE_URL;
        const SUPABASE_ANON_KEY = window.ENV?.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) { console.error('Supabase credentials not found'); return; }
        this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    loadFromStorage() {
        const theme = localStorage.getItem('theme') || 'dark';
        if (document.body) document.body.setAttribute('data-theme', theme);
        this.currentTheme = theme;
        this.loadEnvironmentVariables();
    }

    async loadEnvironmentVariables() {
        try {
            const response = await fetch('/api/env');
            if (response.ok) {
                const envVars = await response.json();
                window.ENV = envVars;
                this.initSupabase();
                window.simpleAI = new SimpleAI();
                // FIX: После загрузки env — если есть локальная сессия, грузим данные из Supabase
                if (this.currentUser && this.supabase) {
                    await Promise.allSettled([
                        this.loadMedicalInfo(), this.loadMeals(),
                        this.loadMealPlans(), this.loadWeightProgress()
                    ]);
                    if (window._onDataReady) window._onDataReady();
                }
            } else {
                console.error('Failed to load env from API');
            }
        } catch (error) {
            console.error('Error loading env:', error);
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
        } catch (error) { return { success: false, error: error.message }; }
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
        } catch (error) { return { success: false, error: error.message }; }
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
            const d = new Date(); d.setDate(d.getDate() - 14);
            const { data, error } = await this.supabase
                .from('meals').select('*').eq('user_id', this.currentUser.id)
                .gte('meal_date', d.toISOString().split('T')[0])
                .order('created_at', { ascending: false });
            if (!error) this.meals = data || [];
        } catch (e) { console.error('loadMeals:', e); }
    }

    async loadMealPlans() {
        try {
            const { data, error } = await this.supabase
                .from('meal_plans').select('*').eq('user_id', this.currentUser.id)
                .order('plan_date', { ascending: false }).limit(14);
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
        } catch (error) { return { success: false, error: error.message }; }
    }

    async addMedicalInfo(medicalData) {
        try {
            const { data, error } = await this.supabase
                .from('medical_info').insert({ user_id: this.currentUser.id, ...medicalData }).select().single();
            if (error) throw error;
            this.medicalInfo.push(data);
            return { success: true, data };
        } catch (error) { return { success: false, error: error.message }; }
    }

    async deleteMedicalInfo(id) {
        try {
            const { error } = await this.supabase
                .from('medical_info').delete().eq('id', id).eq('user_id', this.currentUser.id);
            if (error) throw error;
            this.medicalInfo = this.medicalInfo.filter(item => item.id !== id);
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
    }

    async addMeal(mealData) {
        try {
            const { data, error } = await this.supabase
                .from('meals').insert({ user_id: this.currentUser.id, ...mealData }).select().single();
            if (error) throw error;
            this.meals.unshift(data);
            return { success: true, data };
        } catch (error) { return { success: false, error: error.message }; }
    }

    async deleteMeal(id) {
        try {
            const { error } = await this.supabase
                .from('meals').delete().eq('id', id).eq('user_id', this.currentUser.id);
            if (error) throw error;
            this.meals = this.meals.filter(m => m.id !== id);
            return { success: true };
        } catch (error) { return { success: false, error: error.message }; }
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
        } catch (error) { return { success: false, error: error.message }; }
    }

    async addWeightProgress(weightData) {
        try {
            const { data, error } = await this.supabase
                .from('weight_progress').insert({ user_id: this.currentUser.id, ...weightData }).select().single();
            if (error) throw error;
            this.weightProgress.unshift(data);
            return { success: true, data };
        } catch (error) { return { success: false, error: error.message }; }
    }

    getStatsForDate(date) {
        return this.meals.filter(m => m.meal_date === date).reduce(
            (s, m) => ({
                calories: s.calories + (m.calories || 0),
                protein: s.protein + (m.protein || 0),
                fat: s.fat + (m.fat || 0),
                carbs: s.carbs + (m.carbs || 0)
            }),
            { calories: 0, protein: 0, fat: 0, carbs: 0 }
        );
    }

    getTodayMeals() { return this.getMealsForDate(new Date().toISOString().split('T')[0]); }
    getTodayStats() { return this.getStatsForDate(new Date().toISOString().split('T')[0]); }
    getMealsForDate(date) { return this.meals.filter(m => m.meal_date === date); }
    getMealPlanForDate(date) { return this.mealPlans.find(p => p.plan_date === date); }

    getWeightTrend() {
        if (this.weightProgress.length < 2) return null;
        const weights = this.weightProgress.slice(0, 7).map(w => w.weight);
        const change = weights[0] - weights[weights.length - 1];
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
            localStorage.setItem('userData', JSON.stringify(this.userData));
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
                welcome: 'Умный контроль питания', login: 'Войти', register: 'Регистрация',
                email: 'Email', password: 'Пароль', name: 'Имя', your_name: 'Ваше имя',
                gender: 'Пол', male: 'Мужской', female: 'Женский', birth_date: 'Дата рождения',
                height_cm: 'Рост (см)', weight_kg: 'Вес (кг)', calorie_goal: 'Цель калорий / день',
                sign_in: 'Войти', sign_up: 'Зарегистрироваться', signing_in: '…',
                welcome_back: 'Добро пожаловать!', registered: 'Регистрация успешна!',
                error_login: 'Неверный email или пароль', error_email_used: 'Этот email уже используется',
                nav_home: 'Главная', nav_add: 'Добавить', nav_plan: 'План', nav_profile: 'Профиль',
                greeting: 'Привет', of_kcal: 'из', kcal: 'ккал', daily_progress: 'Дневной прогресс',
                over_kcal: 'ккал превышение', left_kcal: 'ккал осталось',
                protein: 'Белки', fat: 'Жиры', carbs: 'Углеводы',
                today: 'Сегодня', records: 'записей', no_meals: 'Нет записей за этот день',
                add_meal_btn: 'Добавить приём',
                weight_down: '↓ Вес снижается', weight_up: '↑ Вес растёт', weight_stable: '→ Вес стабилен',
                days7: 'за 7 дней',
                new_meal: 'Новый приём пищи', meal_name: 'Название блюда',
                meal_placeholder: 'Напр. Овсянка с ягодами', category: 'Категория',
                breakfast: 'Завтрак', lunch: 'Обед', dinner: 'Ужин', snack: 'Перекус',
                calories: 'Калории (ккал)', weight: 'Вес (г)', after_add: 'После добавления:',
                add_meal_submit: 'Добавить приём', adding: 'Сохраняем…',
                ai_photo: 'AI Анализ фото', photo_hint: 'Сфотографируйте блюдо',
                photo_sub: 'AI определит калории автоматически', analyzing: '🤖 Анализирую изображение…',
                recognized: '✅ Распознано:', photo_filled: 'Данные из фото заполнены',
                meal_added: 'Приём пищи добавлен ✓', deleted: 'Удалено ✓',
                meal_plan: 'План питания', generate: 'Сгенерировать', today_date: 'на сегодня',
                total_kcal: 'итого ккал', recommendations: 'Рекомендации',
                no_plan: 'План на этот день ещё не создан', generate_plan: 'Сгенерировать план',
                generating: 'Генерирую план питания…', plan_generated: 'План сгенерирован! ✓',
                plan_saved: 'План сохранён ✓', plan_error: 'Ошибка генерации',
                profile: 'Профиль', personal_data: 'Личные данные', save_changes: 'Сохранить изменения',
                weight_note: 'При изменении веса он запишется в историю прогресса',
                medical_data: 'Медицинские данные', add_medical: 'Добавить',
                no_medical: 'Нет медицинских данных', settings: 'Настройки',
                theme: 'Тема', theme_dark: 'Тёмная', theme_light: 'Светлая', language: 'Язык',
                data_updated: 'Данные обновлены ✓', weight_saved: 'Вес записан ✓',
                add_med_title: 'Добавить медданные', med_name: 'Название',
                med_name_placeholder: 'Напр. Аллергия на орехи', med_type: 'Тип',
                disease: 'Заболевание', allergy: 'Аллергия', intolerance: 'Непереносимость',
                severity: 'Тяжесть', mild: 'Лёгкая', moderate: 'Средняя', severe: 'Тяжёлая',
                description: 'Описание (необязательно)', desc_placeholder: 'Дополнительная информация',
                add_btn: 'Добавить', cancel: 'Отмена', med_added: 'Добавлено ✓',
                med_deleted: 'Запись удалена', confirm_delete: 'Удалить эту запись?',
                confirm_logout: 'Выйти из аккаунта?',
                ai_lang: 'ru', ai_lang_name: 'русском',
                // NEW
                eaten: 'Съедено', plan_for_date: 'План на',
                congrats_loss: '🎉 Отлично! Вы похудели на', kg: 'кг', week: 'за неделю',
                update_weight_title: 'Обновить вес',
                current_weight: 'Текущий вес (кг)',
                save_weight: 'Сохранить вес',
                week_summary: 'Итоги недели',
                avg_calories: 'Среднее ккал/день',
                days_tracked: 'дней отслежено',
                view_day: 'Смотреть день',
            },
            kz: {
                welcome: 'Ақылды тамақтану бақылауы', login: 'Кіру', register: 'Тіркелу',
                email: 'Email', password: 'Құпия сөз', name: 'Аты', your_name: 'Атыңыз',
                gender: 'Жынысы', male: 'Еркек', female: 'Әйел', birth_date: 'Туған күні',
                height_cm: 'Бойы (см)', weight_kg: 'Салмағы (кг)', calorie_goal: 'Күндік калория мақсаты',
                sign_in: 'Кіру', sign_up: 'Тіркелу', signing_in: '…',
                welcome_back: 'Қош келдіңіз!', registered: 'Тіркелу сәтті!',
                error_login: 'Email немесе құпия сөз қате', error_email_used: 'Бұл email тіркелген',
                nav_home: 'Басты', nav_add: 'Қосу', nav_plan: 'Жоспар', nav_profile: 'Профиль',
                greeting: 'Сәлем', of_kcal: '/', kcal: 'ккал', daily_progress: 'Күндік прогресс',
                over_kcal: 'ккал асып кетті', left_kcal: 'ккал қалды',
                protein: 'Ақуыз', fat: 'Май', carbs: 'Көмірсу',
                today: 'Бүгін', records: 'жазба', no_meals: 'Бұл күні жазба жоқ',
                add_meal_btn: 'Тамақ қосу',
                weight_down: '↓ Салмақ азаюда', weight_up: '↑ Салмақ өсуде', weight_stable: '→ Салмақ тұрақты',
                days7: '7 күн ішінде',
                new_meal: 'Жаңа тамақ', meal_name: 'Тамақ атауы', meal_placeholder: 'Мыс. Жеміспен сұлы',
                category: 'Санат', breakfast: 'Таңғы ас', lunch: 'Түскі ас', dinner: 'Кешкі ас', snack: 'Тағам',
                calories: 'Калория (ккал)', weight: 'Салмақ (г)', after_add: 'Қосқаннан кейін:',
                add_meal_submit: 'Тамақ қосу', adding: 'Сақталуда…',
                ai_photo: 'AI Фото талдауы', photo_hint: 'Тамақты суретке түсіріңіз',
                photo_sub: 'AI калорияны автоматты анықтайды', analyzing: '🤖 Сурет талдануда…',
                recognized: '✅ Анықталды:', photo_filled: 'Деректер фотодан толтырылды',
                meal_added: 'Тамақ қосылды ✓', deleted: 'Жойылды ✓',
                meal_plan: 'Тамақтану жоспары', generate: 'Жасау', today_date: 'бүгінге',
                total_kcal: 'жалпы ккал', recommendations: 'Ұсыныстар',
                no_plan: 'Бұл күнге жоспар жоқ', generate_plan: 'Жоспар жасау',
                generating: 'Тамақтану жоспары жасалуда…', plan_generated: 'Жоспар жасалды! ✓',
                plan_saved: 'Жоспар сақталды ✓', plan_error: 'Жасау қатесі',
                profile: 'Профиль', personal_data: 'Жеке деректер', save_changes: 'Өзгерістерді сақтау',
                weight_note: 'Салмақты өзгерту оны прогресс тарихына жазады',
                medical_data: 'Медициналық деректер', add_medical: 'Қосу',
                no_medical: 'Медициналық деректер жоқ', settings: 'Параметрлер',
                theme: 'Тақырып', theme_dark: 'Күңгірт', theme_light: 'Жарық', language: 'Тіл',
                data_updated: 'Деректер жаңартылды ✓', weight_saved: 'Салмақ жазылды ✓',
                add_med_title: 'Медициналық деректер қосу', med_name: 'Атауы',
                med_name_placeholder: 'Мыс. Жаңғаққа аллергия', med_type: 'Түрі',
                disease: 'Ауру', allergy: 'Аллергия', intolerance: 'Төзбеушілік',
                severity: 'Ауырлық', mild: 'Жеңіл', moderate: 'Орташа', severe: 'Ауыр',
                description: 'Сипаттама (міндетті емес)', desc_placeholder: 'Қосымша ақпарат',
                add_btn: 'Қосу', cancel: 'Болдырмау', med_added: 'Қосылды ✓',
                med_deleted: 'Жазба жойылды', confirm_delete: 'Бұл жазбаны жою керек пе?',
                confirm_logout: 'Шыққыңыз келе ме?',
                ai_lang: 'kz', ai_lang_name: 'казахском',
                eaten: 'Жеді', plan_for_date: 'Жоспар',
                congrats_loss: '🎉 Керемет! Салмақ азайды', kg: 'кг', week: 'апта ішінде',
                update_weight_title: 'Салмақты жаңарту', current_weight: 'Ағымдағы салмақ (кг)',
                save_weight: 'Салмақты сақтау', week_summary: 'Апта қорытындысы',
                avg_calories: 'Орташа ккал/күн', days_tracked: 'күн бақыланды', view_day: 'Күнді қарау',
            },
            en: {
                welcome: 'Smart Nutrition Control', login: 'Log In', register: 'Sign Up',
                email: 'Email', password: 'Password', name: 'Name', your_name: 'Your name',
                gender: 'Gender', male: 'Male', female: 'Female', birth_date: 'Date of Birth',
                height_cm: 'Height (cm)', weight_kg: 'Weight (kg)', calorie_goal: 'Daily Calorie Goal',
                sign_in: 'Log In', sign_up: 'Create Account', signing_in: '…',
                welcome_back: 'Welcome back!', registered: 'Registration successful!',
                error_login: 'Invalid email or password', error_email_used: 'This email is already in use',
                nav_home: 'Home', nav_add: 'Add', nav_plan: 'Plan', nav_profile: 'Profile',
                greeting: 'Hey', of_kcal: 'of', kcal: 'kcal', daily_progress: 'Daily Progress',
                over_kcal: 'kcal over', left_kcal: 'kcal left',
                protein: 'Protein', fat: 'Fat', carbs: 'Carbs',
                today: 'Today', records: 'entries', no_meals: 'No entries for this day',
                add_meal_btn: 'Add Meal',
                weight_down: '↓ Weight decreasing', weight_up: '↑ Weight increasing', weight_stable: '→ Weight stable',
                days7: 'over 7 days',
                new_meal: 'New Meal Entry', meal_name: 'Dish name', meal_placeholder: 'e.g. Oatmeal with berries',
                category: 'Category', breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
                calories: 'Calories (kcal)', weight: 'Weight (g)', after_add: 'After adding:',
                add_meal_submit: 'Add Meal', adding: 'Saving…',
                ai_photo: 'AI Photo Analysis', photo_hint: 'Take a photo of your meal',
                photo_sub: 'AI will detect calories automatically', analyzing: '🤖 Analyzing image…',
                recognized: '✅ Recognized:', photo_filled: 'Fields filled from photo',
                meal_added: 'Meal added ✓', deleted: 'Deleted ✓',
                meal_plan: 'Meal Plan', generate: 'Generate', today_date: 'for today',
                total_kcal: 'total kcal', recommendations: 'Recommendations',
                no_plan: 'No plan for this day yet', generate_plan: 'Generate Plan',
                generating: 'Generating meal plan…', plan_generated: 'Plan generated! ✓',
                plan_saved: 'Plan saved ✓', plan_error: 'Generation error',
                profile: 'Profile', personal_data: 'Personal Data', save_changes: 'Save Changes',
                weight_note: 'Changing weight will record it in progress history',
                medical_data: 'Medical Data', add_medical: 'Add', no_medical: 'No medical data',
                settings: 'Settings', theme: 'Theme', theme_dark: 'Dark', theme_light: 'Light', language: 'Language',
                data_updated: 'Data updated ✓', weight_saved: 'Weight saved ✓',
                add_med_title: 'Add Medical Info', med_name: 'Name',
                med_name_placeholder: 'e.g. Nut allergy', med_type: 'Type',
                disease: 'Disease', allergy: 'Allergy', intolerance: 'Intolerance',
                severity: 'Severity', mild: 'Mild', moderate: 'Moderate', severe: 'Severe',
                description: 'Description (optional)', desc_placeholder: 'Additional information',
                add_btn: 'Add', cancel: 'Cancel', med_added: 'Added ✓',
                med_deleted: 'Record deleted', confirm_delete: 'Delete this record?',
                confirm_logout: 'Log out of account?',
                ai_lang: 'en', ai_lang_name: 'English',
                eaten: 'Eaten', plan_for_date: 'Plan for',
                congrats_loss: '🎉 Great! You lost', kg: 'kg', week: 'this week',
                update_weight_title: 'Update Weight', current_weight: 'Current weight (kg)',
                save_weight: 'Save Weight', week_summary: 'Weekly Summary',
                avg_calories: 'Avg kcal/day', days_tracked: 'days tracked', view_day: 'View day',
            }
        };
    }

    t(key) { return this.translations[this.lang]?.[key] ?? this.translations['ru']?.[key] ?? key; }
    setLang(lang) { this.lang = lang; localStorage.setItem('lang', lang); }
    getLang() { return this.lang; }
}

// ════════════════════════════════════════════════════════════════
// AI
// ════════════════════════════════════════════════════════════════

class SimpleAI {
    constructor() {
        this.apiKey = window.ENV?.NEXT_PUBLIC_GEMINI_API_KEY;
        this.models = ['gemini-2.5-flash', 'gemini-1.5-flash-latest'];
        if (!this.apiKey) console.error('Gemini API key not found');
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
        if (lang === 'kz') return 'Respond in Kazakh language. All dish names and recommendations must be in Kazakh.';
        if (lang === 'en') return 'Respond in English. All dish names and recommendations must be in English.';
        return 'Respond in Russian language. All dish names and recommendations must be in Russian.';
    }

    async analyzeImage(imageBase64, medicalInfo = []) {
        // FIX: передаём медданные явно с предупреждением
        const medCtx = medicalInfo.length > 0
            ? `CRITICAL: User has the following medical conditions and allergies — NEVER suggest or include these in ANY form: ${medicalInfo.map(m => `${m.name} (${m.info_type}, ${m.severity})`).join('; ')}. If the photo contains any of these ingredients, warn in the warnings array.`
            : '';
        const langInstr = this._getLangInstruction();
        return this._withFallback((_m) => ({
            contents: [{
                parts: [
                    { text: `You are a dietitian. Analyze the food photo and return ONLY valid JSON without markdown.\n${langInstr}\n${medCtx}\nFormat: {"name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"weight":0,"category":"breakfast","warnings":[]}\nIf the dish contains ingredients the user is allergic to, add a warning. If no food found: {"error":"Food not found in photo"}` },
                    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
                ]
            }]
        }));
    }

    async generateMealPlan(userData, medicalInfo = [], previousDaysData = []) {
        const goal = userData?.daily_calorie_goal || 2000;

        // FIX: жёсткий запрет на ингредиенты из медданных
        let medCtx = '';
        if (medicalInfo.length > 0) {
            const forbidden = medicalInfo.map(m => `"${m.name}" (${m.info_type})`).join(', ');
            medCtx = `\n⚠️ CRITICAL SAFETY REQUIREMENT: The user has the following medical conditions/allergies/intolerances: ${forbidden}.\nYOU MUST ABSOLUTELY NEVER include any of these ingredients or foods in the meal plan, not even in small amounts. This is a matter of health and safety. Double-check each meal against this list before responding.`;
        }

        const langInstr = this._getLangInstruction();
        const prompt = `Create a one-day meal plan. ${langInstr}

User: ${userData?.name || 'User'}, age ${this.calcAge(userData?.birth_date)}, ${userData?.gender || 'unknown'}, height ${userData?.height || '?'}cm, weight ${userData?.weight || '?'}kg, goal ${goal} kcal/day.${medCtx}

Return ONLY valid JSON without markdown:

{"breakfast":{"name":"...","calories":400,"protein":15,"fat":10,"carbs":65},"lunch":{"name":"...","calories":500,"protein":40,"fat":20,"carbs":45},"dinner":{"name":"...","calories":450,"protein":35,"fat":15,"carbs":50},"snack":{"name":"...","calories":150,"protein":5,"fat":8,"carbs":25},"recommendations":["...","..."],"adjustments":"..."}`;

        try {
            const plan = await this._withFallback(() => ({ contents: [{ parts: [{ text: prompt }] }] }));
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
                ru: { b:'Творог с фруктами', l:'Куриный суп с овощами', d:'Запечённая рыба с рисом', s:'Орехи и яблоко', r:['Пейте больше воды', 'Снизьте потребление сахара'] },
                kz: { b:'Жемістері бар сүзбе', l:'Тауықты көкөніс сорпасы', d:'Күріш пен балық', s:'Жаңғақ пен алма', r:['Көбірек су ішіңіз', 'Қант тұтынуды азайтыңыз'] },
                en: { b:'Cottage cheese with fruits', l:'Chicken vegetable soup', d:'Baked fish with rice', s:'Nuts and apple', r:['Drink more water', 'Reduce sugar intake'] },
            };
            const fb = fallbacks[lang] || fallbacks.ru;
            return {
                breakfast: { name: fb.b, calories: breakfastCal, protein: Math.round(breakfastCal*0.15/4), fat: Math.round(breakfastCal*0.25/9), carbs: Math.round(breakfastCal*0.60/4) },
                lunch:     { name: fb.l, calories: lunchCal,     protein: Math.round(lunchCal*0.35/4),     fat: Math.round(lunchCal*0.30/9),     carbs: Math.round(lunchCal*0.35/4) },
                dinner:    { name: fb.d, calories: dinnerCal,    protein: Math.round(dinnerCal*0.40/4),    fat: Math.round(dinnerCal*0.30/9),    carbs: Math.round(dinnerCal*0.30/4) },
                snack:     { name: fb.s, calories: snackCal,     protein: Math.round(snackCal*0.10/4),     fat: Math.round(snackCal*0.40/9),     carbs: Math.round(snackCal*0.50/4) },
                recommendations: fb.r, adjustments: `Goal: ${goal} kcal`,
                total_calories: goal, total_protein: Math.round(goal*0.25/4),
                total_fat: Math.round(goal*0.30/9), total_carbs: Math.round(goal*0.45/4)
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
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
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

console.log('✅ Smart Nutrition JS loaded (i18n + fixes enabled)');