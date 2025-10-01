
import { reactive } from 'vue'
import type { ServiceResult } from '@/contracts/service.result'

const snackbarState = reactive({
    visible: false,
    title: '',
    message: '',
    type: 'info' as 'success' | 'error' | 'warning' | 'info',
    serviceResults: [] as ServiceResult[]
})

export function useInfoSnackbar() {
    const showSuccess = (title: string, message?: string, serviceResults?: ServiceResult[]) => {
        Object.assign(snackbarState, {
            visible: true,
            title,
            message: message || '',
            type: 'success',
            serviceResults: serviceResults || []
        })
    }

    const showError = (title: string, message?: string) => {
        Object.assign(snackbarState, {
            visible: true,
            title,
            message: message || '',
            type: 'error',
            serviceResults: []
        })
    }

    return { snackbarState, showSuccess, showError }
}