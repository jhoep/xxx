require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { DisTube } = require('distube');
const { YtDlpPlugin } = require('@distube/yt-dlp');
const express = require('express'); // NUEVO

// Servidor HTTP para Render
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Bot de música está en línea!');
});

app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        servers: client.guilds.cache.size,
        uptime: process.uptime()
    });
});

app.listen(PORT, () => {
    console.log(`🌐 Servidor HTTP en puerto ${PORT}`);
});

// ... resto de tu código del bot de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = '>>';

const distube = new DisTube(client, {
    emitNewSongOnly: true,
    leaveOnEmpty: true,
    leaveOnFinish: false,
    leaveOnStop: true,
    savePreviousSongs: true,
    searchSongs: 5,
    nsfw: false,
    emptyCooldown: 300,
    emitAddSongWhenCreatingQueue: false,
    emitAddListWhenCreatingQueue: false,
    plugins: [new YtDlpPlugin()]
});

client.on('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`📊 Servidor(es): ${client.guilds.cache.size}`);
    
    client.user.setPresence({
        activities: [{ 
            name: 'música | >>help', 
            type: ActivityType.Playing 
        }],
        status: 'online'
    });
});

distube
    .on('playSong', (queue, song) => {
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Reproduciendo ahora')
            .setDescription(`[${song.name}](${song.url})`)
            .addFields(
                { name: '⏱️ Duración', value: song.formattedDuration, inline: true },
                { name: '👤 Solicitado por', value: song.user.tag, inline: true },
                { name: '📝 En cola', value: `${queue.songs.length} canción${queue.songs.length !== 1 ? 'es' : ''}`, inline: true }
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
    .on('addList', (queue, playlist) => {
        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('📑 Playlist añadida')
            .setDescription(`**${playlist.name}**`)
            .addFields(
                { name: '🎵 Canciones', value: `${playlist.songs.length}`, inline: true },
                { name: '⏱️ Duración total', value: playlist.formattedDuration, inline: true }
            )
            .setThumbnail(playlist.thumbnail);
        
        queue.textChannel.send({ embeds: [embed] });
    })
    .on('error', (channel, error) => {
        console.error('DisTube Error:', error);
        if (channel) {
            channel.send(`❌ Error: ${error.message.slice(0, 100)}`);
        }
    })
    .on('empty', queue => {
        queue.textChannel.send('⏹️ Canal de voz vacío. Desconectándome...');
    })
    .on('finish', queue => {
        queue.textChannel.send('✅ Cola terminada.');
    })
    .on('disconnect', queue => {
        queue.textChannel.send('👋 Desconectado del canal de voz.');
    })
    .on('initQueue', queue => {
        queue.autoplay = false;
        queue.volume = 100;
    });

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    const requireVoice = ['play', 'p', 'skip', 's', 'stop', 'pause', 'resume', 'clear', 'shuffle'];
    if (requireVoice.includes(command) && !message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz para usar este comando.');
    }

    try {
        switch(command) {
            case 'play':
            case 'p':
                if (!args.length) {
                    return message.reply('❌ Proporciona un enlace o nombre de canción.\n**Ejemplo:** `>>play despacito`');
                }
                
                const searchMsg = await message.channel.send('🔍 Buscando...');
                
                try {
                    await distube.play(message.member.voice.channel, args.join(' '), {
                        member: message.member,
                        textChannel: message.channel,
                        message
                    });
                    await searchMsg.delete();
                } catch (error) {
                    await searchMsg.delete();
                    throw error;
                }
                break;

            case 'skip':
            case 's':
                const queue = distube.getQueue(message);
                if (!queue) return message.reply('❌ No hay nada reproduciéndose.');
                
                try {
                    await distube.skip(message);
                    message.react('⏭️');
                } catch (error) {
                    message.reply('❌ No hay más canciones en la cola.');
                }
                break;

            case 'stop':
            case 'disconnect':
            case 'dc':
                const stopQueue = distube.getQueue(message);
                if (!stopQueue) return message.reply('❌ No hay nada reproduciéndose.');
                
                await distube.stop(message);
                message.reply('⏹️ Reproducción detenida y desconectado.');
                break;

            case 'pause':
                const pauseQueue = distube.getQueue(message);
                if (!pauseQueue) return message.reply('❌ No hay nada reproduciéndose.');
                if (pauseQueue.paused) return message.reply('❌ Ya está en pausa.');
                
                distube.pause(message);
                message.react('⏸️');
                break;

            case 'resume':
            case 'r':
                const resumeQueue = distube.getQueue(message);
                if (!resumeQueue) return message.reply('❌ No hay nada en la cola.');
                if (!resumeQueue.paused) return message.reply('❌ No está en pausa.');
                
                distube.resume(message);
                message.react('▶️');
                break;

            case 'queue':
            case 'q':
                const queueList = distube.getQueue(message);
                if (!queueList) return message.reply('❌ La cola está vacía.');
                
                const songs = queueList.songs.slice(0, 10).map((song, index) => {
                    const prefix = index === 0 ? '🎵 **[Reproduciendo]**' : `**${index}.**`;
                    return `${prefix} [${song.name}](${song.url}) - \`${song.formattedDuration}\``;
                }).join('\n\n');

                const embed = new EmbedBuilder()
                    .setColor('#0099ff')
                    .setTitle('📜 Cola de Reproducción')
                    .setDescription(songs)
                    .setFooter({ text: `Total: ${queueList.songs.length} canción${queueList.songs.length !== 1 ? 'es' : ''}` });
                
                if (queueList.songs.length > 10) {
                    embed.addFields({ name: '\u200b', value: `*...y ${queueList.songs.length - 10} más*` });
                }

                message.channel.send({ embeds: [embed] });
                break;

            case 'nowplaying':
            case 'np':
                const npQueue = distube.getQueue(message);
                if (!npQueue) return message.reply('❌ No hay nada reproduciéndose.');
                
                const song = npQueue.songs[0];
                const npEmbed = new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('🎵 Reproduciendo ahora')
                    .setDescription(`[${song.name}](${song.url})`)
                    .addFields(
                        { name: '⏱️ Duración', value: song.formattedDuration, inline: true },
                        { name: '👤 Solicitado por', value: song.user.tag, inline: true },
                        { name: '📝 En cola', value: `${npQueue.songs.length - 1}`, inline: true }
                    )
                    .setThumbnail(song.thumbnail)
                    .setTimestamp();
                
                message.channel.send({ embeds: [npEmbed] });
                break;

            case 'volume':
            case 'vol':
                const volQueue = distube.getQueue(message);
                if (!volQueue) return message.reply('❌ No hay nada reproduciéndose.');
                
                const volume = parseInt(args[0]);
                if (isNaN(volume) || volume < 0 || volume > 100) {
                    return message.reply(`🔊 Volumen actual: **${volQueue.volume}%**\nUsa: \`>>volume [0-100]\``);
                }
                
                volQueue.setVolume(volume);
                message.reply(`🔊 Volumen ajustado a **${volume}%**`);
                break;

            case 'help':
            case 'h':
                const helpEmbed = new EmbedBuilder()
                    .setColor('#9b59b6')
                    .setTitle('🎵 Comandos del Bot de Música')
                    .setDescription('Prefix: `>>`')
                    .addFields(
                        { 
                            name: '🎵 Reproducción', 
                            value: '`>>play [canción]` - Reproduce música\n' +
                                   '`>>pause` - Pausa\n' +
                                   '`>>resume` - Reanuda\n' +
                                   '`>>skip` - Siguiente\n' +
                                   '`>>stop` - Detiene',
                            inline: false 
                        },
                        { 
                            name: '📋 Cola', 
                            value: '`>>queue` - Ver cola\n' +
                                   '`>>nowplaying` - Canción actual\n' +
                                   '`>>volume [0-100]` - Volumen',
                            inline: false 
                        }
                    )
                    .setFooter({ text: 'Bot de Música con DisTube' })
                    .setTimestamp();
                
                message.channel.send({ embeds: [helpEmbed] });
                break;
        }
    } catch (error) {
        console.error(`Error en comando ${command}:`, error);
        message.reply(`❌ Error: ${error.message}`);
    }
});

process.on('unhandledRejection', error => {
    console.error('Error no manejado:', error);
});

client.on('error', error => {
    console.error('Error del cliente:', error);
});

client.login(process.env.DISCORD_TOKEN);
