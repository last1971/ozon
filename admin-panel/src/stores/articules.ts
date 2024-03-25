import { defineStore } from 'pinia'

export const articulesStore = defineStore('articules', {
    state: () => ({
        articules: [] as string[],
    }),
    actions: {
        push(articule: string) {
            this.articules.push(articule);
        },
        set(value: string, index: number) {
            this.articules[index] = value;
        },
        delete(index: number) {
            this.articules.splice(index, 1)
        }
    }
});