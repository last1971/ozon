module.exports = {
    apps: [
        {
            name: 'ozon',
            script: 'dist/main.js',
            watch: false,
            env: {
                NO_COLOR: true,
            },
            nodeArgs: '--tls-cipher-list=DEFAULT@SECLEVEL=0',
        },
    ],
};
