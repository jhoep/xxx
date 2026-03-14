require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = '>>';

// Configurar DisTube - ¡ESTO SOLUCIONA EL ERROR!
const distube = new DisTube(client, {
    leaveOnEmpty: true,
    leaveOnFinish: true,
    leaveOnStop: true,
    emptyCooldown: 60, // 1 minuto antes de desconectar
    searchSongs: 5,
    nsfw: false,
    plugins: [
        new YtDlpPlugin({
            update: false // Desactiva auto-update para evitar problemas en Render
        })
    ]
});

client.on('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    client.user.setPresence({
        activities: [{ name: 'música | >>help', type: ActivityType.Playing }],
        status: 'online'
    });
});

// Eventos de DisTube
distube
    .on('playSong', (queue, song) => {
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Reproduciendo ahora')
            .setDescription(`[${song.name}](${song.url})`)
            .addFields(
                { name: '⏱️ Duración', value: song.formattedDuration, inline: true },
                { name: '👤 Solicitado por', value: song.user.tag, inline: true },
                { name: '📝 En cola', value: `${queue.songs.length - 1} más`, inline: true }
            )
            .setThumbnail(song.thumbnail);
        
        queue.textChannel.send({ embeds: [embed] });
    })
    .on('addSong', (queue, song) => {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('➕ Añadido a la cola')
            .setDescription(`[${song.name}](${song.url})`)
            .addFields(
                { name: '⏱️ Duración', value: song.formattedDuration, inline: true },
                { name: '📝 Posición', value: `#${queue.songs.length}`, inline: true }
            )
            .setThumbnail(song.thumbnail);
        
        queue.textChannel.send({ embeds: [embed] });
    })
    .on('error', (channel, error) => {
        console.error('❌ DisTube Error:', error);
        if (channel) {
            channel.send(`❌ Error: ${error.message.slice(0, 100)}`);
        }
    })
    .on('disconnect', queue => {
        queue.textChannel.send('👋 Desconectado del canal de voz.');
    })
    .on('empty', queue => {
        queue.textChannel.send('⏹️ Canal vacío. Desconectándome...');
    });

// Comandos
client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    if (!message.member.voice.channel && ['play', 'p', 'skip', 's', 'stop', 'pause', 'resume'].includes(command)) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    try {
        switch(command) {
            case 'play':
            case 'p':
                if (!args.length) return message.reply('❌ Proporciona una canción.\n**Ejemplo:** `>>play despacito`');
                await distube.play(message.member.voice.channel, args.join(' '), {
                    member: message.member,
                    textChannel: message.channel,
                    message
                });
                break;

            case 'skip':
            case 's':
                await distube.skip(message);
                message.react('⏭️');
                break;

            case 'stop':
            case 'dc':
                await distube.stop(message);
                message.reply('⏹️ Detenido y desconectado.');
                break;

            case 'pause':
                distube.pause(message);
                message.react('⏸️');
                break;

            case 'resume':
            case 'r':
                distube.resume(message);
                message.react('▶️');
                break;

            case 'queue':
            case 'q':
                const queue = distube.getQueue(message);
                if (!queue) return message.reply('❌ La cola está vacía.');
                
                const songs = queue.songs.slice(0, 10).map((song, index) => {
                    const prefix = index === 0 ? '🎵 **[Reproduciendo]**' : `**${index}.**`;
                    return `${prefix} [${song.name}](${song.url}) - \`${song.formattedDuration}\``;
                }).join('\n\n');

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('📜 Cola de Reproducción')
                    .setDescription(songs)
                    .setFooter({ text: `Total: ${queue.songs.length} canción${queue.songs.length !== 1 ? 'es' : ''}` });
                
                message.channel.send({ embeds: [embed] });
                break;

            case 'nowplaying':
            case 'np':
                const np = distube.getQueue(message);
                if (!np) return message.reply('❌ No hay nada reproduciéndose.');
                
                const song = np.songs[0];
                const npEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🎵 Reproduciendo ahora')
                    .setDescription(`[${song.name}](${song.url})`)
                    .addFields(
                        { name: '⏱️ Duración', value: song.formattedDuration, inline: true },
                        { name: '👤 Solicitado por', value: song.user.tag, inline: true }
                    )
                    .setThumbnail(song.thumbnail);
                
                message.channel.send({ embeds: [npEmbed] });
                break;

            case 'help':
            case 'h':
                const helpEmbed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle('🎵 Comandos')
                    .setDescription('Prefix: `>>`')
                    .addFields(
                        { name: '🎵 Reproducción', value: '`>>play [canción]`\n`>>pause`\n`>>resume`\n`>>skip`\n`>>stop`' },
                        { name: '📋 Cola', value: '`>>queue`\n`>>nowplaying`' }
                    );
                
                message.channel.send({ embeds: [helpEmbed] });
                break;
        }
    } catch (error) {
        console.error('❌ Error en comando:', error);
        message.reply(`❌ Error: ${error.message}`);
    }
});

// Manejo de errores
process.on('unhandledRejection', error => {
    console.error('❌ Error no manejado:', error);
});

// Login
client.login(process.env.DISCORD_TOKEN);
