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
        // Supabase data from environment variables (Vercel injects these)
        const SUPABASE_URL = window.ENV?.NEXT_PUBLIC_SUPABASE_URL || 'https://hoqzwcpdkaxmvpkqdaln.supabase.co';
        const SUPABASE_ANON_KEY = window.ENV?.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_n2ygu9xlDMUZBL5w8YyqIg_k-tRuj-f';
        
        this.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }

    loadFromStorage() {
        const theme = localStorage.getItem('theme') || 'dark';
        if (document.body) document.body.setAttribute('data-theme', theme);
        this.currentTheme = theme;
    }

    // ── АВТОРИЗАЦИЯ ──────────────────────────────────────────────────────

    async login(email, password) {
        try {
            if (!this.supabase) return { success: false, error: 'Нет подключения к базе данных' };

            const { data: userData, error: userError } = await this.supabase
                .from('users')
                .select('*')
                .eq('email', email)
                .eq('password_hash', password)
                .single();

            if (userError) {
                if (userError.code === 'PGRST116') return { success: false, error: 'Неверный email или пароль' };
                throw userError;
            }
            if (!userData) return { success: false, error: 'Неверный email или пароль' };

            this.currentUser = { id: userData.id, email: userData.email };
            this.userData = userData;
            this.saveLocalSession();

            await Promise.allSettled([
                this.loadMedicalInfo(),
                this.loadMeals(),
                this.loadMealPlans(),
                this.loadWeightProgress()
            ]);

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async register(userData) {
        try {
            const { data: existingUser } = await this.supabase
                .from('users')
                .select('id')
                .eq('email', userData.email)
                .single();

            if (existingUser) return { success: false, error: 'Этот email уже используется' };

            const { data: newUser, error: userError } = await this.supabase
                .from('users')
                .insert({
                    email:              userData.email,
                    password_hash:      userData.password,
                    name:               userData.name,
                    gender:             userData.gender,
                    birth_date:         userData.birthDate,
                    height:             userData.height,
                    weight:             userData.weight,
                    daily_calorie_goal: userData.calorieGoal || 2000,
                    theme:              this.currentTheme
                })
                .select()
                .single();

            if (userError) throw userError;

            this.currentUser = { id: newUser.id, email: newUser.email };
            this.userData = newUser;
            this.saveLocalSession();

            if (userData.weight) {
                await this.addWeightProgress({
                    weight:        userData.weight,
                    measured_date: new Date().toISOString().split('T')[0],
                    note:          'Начальный вес'
                });
            }

            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async logout() {
        this.currentUser    = null;
        this.userData       = null;
        this.meals          = [];
        this.medicalInfo    = [];
        this.mealPlans      = [];
        this.weightProgress = [];
        localStorage.removeItem('currentUser');
        localStorage.removeItem('userData');
    }

    // ── ЗАГРУЗКА ДАННЫХ ──────────────────────────────────────────────────

    async loadMedicalInfo() {
        try {
            const { data, error } = await this.supabase
                .from('medical_info').select('*').eq('user_id', this.currentUser.id);
            if (!error) this.medicalInfo = data || [];
        } catch (e) { console.error('loadMedicalInfo:', e); }
    }

    async loadMeals() {
        try {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            const { data, error } = await this.supabase
                .from('meals').select('*')
                .eq('user_id', this.currentUser.id)
                .gte('meal_date', d.toISOString().split('T')[0])
                .order('created_at', { ascending: false });
            if (!error) this.meals = data || [];
        } catch (e) { console.error('loadMeals:', e); }
    }

    async loadMealPlans() {
        try {
            const { data, error } = await this.supabase
                .from('meal_plans').select('*')
                .eq('user_id', this.currentUser.id)
                .order('plan_date', { ascending: false }).limit(7);
            if (!error) this.mealPlans = data || [];
        } catch (e) { console.error('loadMealPlans:', e); }
    }

    async loadWeightProgress() {
        try {
            const { data, error } = await this.supabase
                .from('weight_progress').select('*')
                .eq('user_id', this.currentUser.id)
                .order('measured_date', { ascending: false }).limit(30);
            if (!error) this.weightProgress = data || [];
        } catch (e) { console.error('loadWeightProgress:', e); }
    }

    // ── ПОЛЬЗОВАТЕЛЬ ────────────────────────────────────────────────────

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

    // ── МЕДДАННЫЕ ────────────────────────────────────────────────────────

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

    // ── ПРИЁМЫ ПИЩИ ─────────────────────────────────────────────────────

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

    // ── ПЛАНЫ ПИТАНИЯ ─────────────────────────────────────────────────

    async saveMealPlan(planData) {
        try {
            // Check if plan for this date already exists
            const existingPlan = this.mealPlans.find(p => p.plan_date === planData.plan_date);
            
            let data, error;
            if (existingPlan) {
                // Update existing plan
                const result = await this.supabase
                    .from('meal_plans')
                    .update(planData)
                    .eq('id', existingPlan.id)
                    .select().single();
                data = result.data;
                error = result.error;
            } else {
                // Insert new plan
                const result = await this.supabase
                    .from('meal_plans')
                    .insert({ user_id: this.currentUser.id, ...planData })
                    .select().single();
                data = result.data;
                error = result.error;
            }
            
            if (error) throw error;
            
            // Update local array
            const idx = this.mealPlans.findIndex(p => p.plan_date === planData.plan_date);
            if (idx >= 0) this.mealPlans[idx] = data;
            else this.mealPlans.unshift(data);
            
            return { success: true, data };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    // ── ПРОГРЕСС ВЕСА ───────────────────────────────────────────────────

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

    // ── ХЕЛПЕРЫ ─────────────────────────────────────────────────────────

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
// AI
// ════════════════════════════════════════════════════════════════

class SimpleAI {
    constructor() {
        this.apiKey = window.ENV?.NEXT_PUBLIC_GEMINI_API_KEY || 'AIzaSyDK1rrMNQL26T8Skv9aun8lALMiHCRp_CQ';
        this.models = ['gemini-2.5-flash', 'gemini-1.5-flash'];
    }

    // Убирает markdown: **жирный**, *курсив*, # заголовки, - маркеры
    static stripMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/#{1,6}\s*/g, '')
            .replace(/\*\*(.+?)\*\*/g, '$1')
            .replace(/\*(.+?)\*/g, '$1')
            .replace(/^[\-\*]\s+/gm, '• ')
            .replace(/`(.+?)`/g, '$1')
            .trim();
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
        if (!text) throw new Error('Пустой ответ от AI');
        // Убираем ```json ... ``` обёртку
        const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('AI не вернул JSON: ' + clean.slice(0, 200));
        return JSON.parse(match[0]);
    }

    async _withFallback(makeBody) {
        let lastErr;
        for (const model of this.models) {
            try {
                return await this._callAPI(model, makeBody(model));
            } catch (err) {
                console.warn(`[AI] ${model} failed:`, err.message);
                lastErr = err;
                if (err.status === 400 || err.status === 403) break;
            }
        }
        throw lastErr;
    }

    async analyzeImage(imageBase64, medicalInfo = []) {
        const medCtx = medicalInfo.length > 0
            ? `Важно: у пользователя есть ${medicalInfo.map(m => m.name).join(', ')}. Учитывай при анализе.`
            : '';

        return this._withFallback((_m) => ({
            contents: [{
                parts: [
                    { text: `Ты диетолог. Проанализируй фото еды и верни ТОЛЬКО валидный JSON без markdown.\n${medCtx}\nФормат: {"name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"weight":0,"category":"breakfast","warnings":[]}\nЕсли еда не найдена: {"error":"Еда не найдена на фото"}` },
                    { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }
                ]
            }]
        }));
    }

    async generateMealPlan(userData, medicalInfo = [], previousDaysData = []) {
        const medCtx = medicalInfo.length > 0 ? `ÒÅÊ: ${medicalInfo.map(m => `${m.name} (${m.severity})`).join(', ')}.` : '';
        const prevCtx = previousDaysData.length > 0 ? `Ïðåäûäóùèå äíè: ${previousDaysData.map(d => `${d.date}: ${d.calories}êêàë`).join(', ')}` : '';
        
        const prompt = `Ñîñòàâü ïëàí ïèòàíèÿ íà äåíü. ${medCtx} ${prevCtx}
Ïîëüçîâàòåëü: ${userData.name}, ${this.calcAge(userData.birth_date)}ë, ${userData.gender}, ${userData.height}ñì, ${userData.weight}êã, öåëü ${userData.daily_calorie_goal}êêàë.
Âåðíè ÒÎËÜÊÎ JSON áåç êîììåíòàðèåâ:
{"breakfast":{"name":"Îâñÿíêà ñ ÿãîäàìè","calories":400,"protein":15,"fat":10,"carbs":65},"lunch":{"name":"Ãðå÷åñêèé ñàëàò ñ êóðèöåé","calories":500,"protein":40,"fat":20,"carbs":45},"dinner":{"name":"çàïå÷åííàÿ òðåñêà ñ îâîùàìè","calories":450,"protein":35,"fat":15,"carbs":50},"snack":{"name":"ãðåéïôðóêò","calories":100,"protein":1,"fat":0,"carbs":25},"recommendations":["Ïåéòå 2 ëèòðà âîäû","Ñíèçüòü ñàõàð"],"adjustments":"Îáùàÿ êàëîðèéíîñòü 1450 êêàë"}`;
        
        try {
            console.log('Sending prompt to AI...'); // Debug
            const response = await this._withFallback(() => ({ contents: [{ parts: [{ text: prompt }] }] }));
            
            console.log('Raw AI Response type:', typeof response); // Debug
            console.log('Raw AI Response:', response); // Debug
            
            // Èùåì JSON â îòâåòå
            let jsonText = response;
            if (typeof response === 'object') {
                jsonText = JSON.stringify(response);
                console.log('Stringified response:', jsonText); // Debug
            }
            
            const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                console.error('No JSON found in response:', jsonText);
                console.error('Full response text:', jsonText.substring(0, 500)); // First 500 chars
                throw new Error('JSON not found in response');
            }
            
            const planText = jsonMatch[0];
            console.log('Extracted JSON:', planText); // Debug
            
            const plan = JSON.parse(planText);
            console.log('Successfully parsed plan:', plan); // Debug
            
            // Ïðàâèëüíûé ïîäñ÷¸ò èòîãîâ
            plan.total_calories = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.calories||0), 0);
            plan.total_protein  = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.protein||0), 0);
            plan.total_fat      = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.fat||0), 0);
            plan.total_carbs    = ['breakfast','lunch','dinner','snack'].reduce((s,k) => s + (plan[k]?.carbs||0), 0);
            
            console.log('Parsed plan:', plan); // Debug
            return plan;
            
        } catch (error) {
            console.error('Meal plan generation error:', error);
            // Âîçâðàùàåì ïëàí ïî óìîë÷àíèþ åñëè îøèáêà
            return {
                breakfast: { name: "Îâñÿíàÿ êàøà", calories: 350, protein: 12, fat: 8, carbs: 60 },
                lunch: { name: "Êóðèíûé ñàëàò", calories: 450, protein: 35, fat: 15, carbs: 40 },
                dinner: { name: "Ðûáà ñ îâîùàìè", calories: 400, protein: 30, fat: 12, carbs: 45 },
                snack: { name: "Ôðóêòû", calories: 150, protein: 2, fat: 1, carbs: 35 },
                recommendations: ["Ïåéòå áîëüøå âîäû", "Ñíèçüòü ñîëü"],
                adjustments: "Îáùàÿ êàëîðèéíîñòü ñîîòâåòñòâóåò öåëè",
                total_calories: 1350,
                total_protein: 79,
                total_fat: 36,
                total_carbs: 180
            };
        }
    }

    calcAge(birthDate) {
        if (!birthDate) return 30;
        return Math.floor((Date.now() - new Date(birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
}

// ════════════════════════════════════════════════════════════════
// ГЛОБАЛЬНЫЕ ЭКЗЕМПЛЯРЫ
// ════════════════════════════════════════════════════════════════

window.simpleState = new SimpleState();
window.simpleAI    = new SimpleAI();

// showToast — fallback; основная версия в HTML перекрывает её
window.showToast = window.showToast || function(msg, type = 'info') {
    const c = document.getElementById('toastContainer');
    if (!c) { console.log(`[${type}]`, msg); return; }
    const el  = document.createElement('div');
    const col  = type === 'success' ? '#15803d' : type === 'error' ? '#b91c1c' : '#1d4ed8';
    el.style.cssText = `background:${col};color:#fff;padding:.6rem 1rem;border-radius:8px;margin-bottom:6px;font-size:.875rem;box-shadow:0 4px 14px rgba(0,0,0,.3);animation:slideUp .3s ease`;
    el.textContent = msg;
    c.appendChild(el);
    setTimeout(() => { el.style.cssText += ';opacity:0;transform:translateX(110%);transition:all .35s'; setTimeout(() => el.remove(), 360); }, 3200);
};

window.addMeal = async (d) => {
    const r = await window.simpleState.addMeal(d);
    window.showToast(r.success ? 'Приём пищи добавлен ✓' : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.deleteMeal = async (id) => {
    const r = await window.simpleState.deleteMeal(id);
    window.showToast(r.success ? 'Удалено ✓' : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.addMedicalInfo = async (d) => {
    const r = await window.simpleState.addMedicalInfo(d);
    window.showToast(r.success ? 'Добавлено ✓' : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.updateUserData = async (updates) => {
    const r = await window.simpleState.updateUserData(updates);
    window.showToast(r.success ? 'Данные обновлены ✓' : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.saveMealPlan = async (d) => {
    const r = await window.simpleState.saveMealPlan(d);
    window.showToast(r.success ? 'План сохранён ✓' : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};
window.addWeightProgress = async (d) => {
    const r = await window.simpleState.addWeightProgress(d);
    window.showToast(r.success ? 'Вес записан ✓' : (r.error || 'Ошибка'), r.success ? 'success' : 'error');
    return r;
};

console.log('✅ Smart Nutrition JS loaded');