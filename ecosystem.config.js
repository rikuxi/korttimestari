// pm2-tuotantoasetus: pm2 start ecosystem.config.js
//
// Tarkoituksella yksi prosessi (fork, ei cluster): rate limit -laskurit
// ovat prosessikohtaisia muistissa, joten cluster-tila moninkertaistaisi
// rajat ja jakaisi käyttäjät sattumanvaraisesti eri laskureihin. Raskas
// laskenta menee joka tapauksessa worker-säikeisiin (max 4 rinnakkain),
// joten yksi prosessi riittää.
module.exports = {
    apps: [{
        name: 'korttimestari',
        script: 'server.js',
        instances: 1,
        exec_mode: 'fork',
        // Taulukkovälimuisti lämmitettynä ~600 MB RSS; raja on reilusti
        // yli normaalin, joten se laukeaa vain aidossa muistivuodossa
        max_memory_restart: '2G',
        env: {
            NODE_ENV: 'production',
            PORT: 3002,
            // Node on nginxin takana samalla koneella: luota loopbackiin,
            // nginx validoi Cloudflaren (set_real_ip_from + palomuuri).
            // Katso README: Ympäristömuuttujat.
            TRUST_PROXY_IPS: 'loopback'
        }
    }]
};
