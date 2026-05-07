import { createSlice } from '@reduxjs/toolkit';

const chatLanguageModelsSlice = createSlice({
    name: 'chatLanguageModels',
    initialState: {
        chatLanguageModels: [],
        loading: false,
        error: null,
    },
    reducers: {
        setChatLanguageModels: (state, action) => {
            state.chatLanguageModels = action.payload;
        },
        setLoading: (state, action) => {
            state.loading = action.payload;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
    },
    extraReducers: {
        // Add any extra reducers here
    },
});

export const { setChatLanguageModels, setLoading, setError } = chatLanguageModelsSlice.actions;

export function removeBuiltInOllamaFromChatLanguageModels() {
    // Implementation here
}

export default chatLanguageModelsSlice.reducer;