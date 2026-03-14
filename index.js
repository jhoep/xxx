require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActivityType } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    NoSubscriberBehavior,
    entersState,
    VoiceConnectionStatus
} = require('@discordjs/voice');
const play = require('play-dl');
const ytdl = require('ytdl-core');
const fs = require('fs');
const path = require('path');

// Configurar cookies para play-dl
const cookiesPath = path.join(__dirname, 'cookies.txt');
if (fs.existsSync(cookiesPath)) {
    play.setToken({
        youtube: {
            cookie: fs.readFileSync(cookiesPath, 'utf-8')
        }
    });
    console.log('✅ Cookies de YouTube cargadas correctamente');
} else {
    console.warn('⚠️ Archivo cookies.txt no encontrado');
}

// Configuración del cliente
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const PREFIX = '>>';
const queues = new Map();

// Clase para manejar la cola de reproducción
class MusicQueue {
    constructor() {
        this.songs = [];
        this.connection = null;
        this.player = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Pause,
            },
        });
        this.isPlaying = false;
        this.volume = 1.0;
        this.textChannel = null;
    }
}

client.on('ready', () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
    console.log(`📊 Servidor(es): ${client.guilds.cache.size}`);
    console.log(`👥 Usuario(s): ${client.users.cache.size}`);
    
    client.user.setPresence({
        activities: [{ 
            name: 'música | >>help', 
            type: ActivityType.Playing 
        }],
        status: 'online'
    });
});

client.on('messageCreate', async message => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Comandos
    switch(command) {
        case 'play':
        case 'p':
            await play_command(message, args);
            break;
        case 'skip':
        case 's':
            await skip_command(message);
            break;
        case 'stop':
        case 'disconnect':
        case 'dc':
            await stop_command(message);
            break;
        case 'pause':
            await pause_command(message);
            break;
        case 'resume':
        case 'r':
            await resume_command(message);
            break;
        case 'queue':
        case 'q':
            await queue_command(message);
            break;
        case 'nowplaying':
        case 'np':
            await nowplaying_command(message);
            break;
        case 'clear':
            await clear_command(message);
            break;
        case 'remove':
            await remove_command(message, args);
            break;
        case 'shuffle':
            await shuffle_command(message);
            break;
        case 'loop':
        case 'repeat':
            await loop_command(message, args);
            break;
        case 'help':
        case 'h':
            await help_command(message);
            break;
        default:
            break;
    }
});

// Comando PLAY
async function play_command(message, args) {
    const voiceChannel = message.member.voice.channel;
    
    if (!voiceChannel) {
        return message.reply('❌ Debes estar en un canal de voz para usar este comando.');
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has('Connect') || !permissions.has('Speak')) {
        return message.reply('❌ No tengo permisos para conectarme o hablar en tu canal de voz.');
    }

    if (!args.length) {
        return message.reply('❌ Debes proporcionar un enlace o nombre de canción.\n**Ejemplo:** `>>play despacito`');
    }

    const query = args.join(' ');
    
    try {
        const searchMsg = await message.channel.send('🔍 Buscando...');

        let song;
        let isPlaylist = false;

        // Verificar si es una URL de YouTube
        if (ytdl.validateURL(query)) {
            const songInfo = await ytdl.getInfo(query);
            song = {
                title: songInfo.videoDetails.title,
                url: songInfo.videoDetails.video_url,
                duration: formatDuration(parseInt(songInfo.videoDetails.lengthSeconds)),
                thumbnail: songInfo.videoDetails.thumbnails[songInfo.videoDetails.thumbnails.length - 1].url,
                requester: message.author.tag
            };
        } 
        // Verificar si es una playlist
        else if (query.includes('playlist?list=')) {
            const playlist = await play.playlist_info(query, { incomplete: true });
            const videos = await playlist.all_videos();
            
            isPlaylist = true;
            const songs = videos.map(video => ({
                title: video.title,
                url: video.url,
                duration: formatDuration(video.durationInSec),
                thumbnail: video.thumbnails[0].url,
                requester: message.author.tag
            }));

            let queue = queues.get(message.guild.id);
            
            if (!queue) {
                queue = new MusicQueue();
                queue.textChannel = message.channel;
                queues.set(message.guild.id, queue);
                
                queue.connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });

                queue.connection.subscribe(queue.player);
            }

            queue.songs.push(...songs);
            
            await searchMsg.delete();
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('📑 Playlist añadida')
                .setDescription(`**${playlist.title}**`)
                .addFields(
                    { name: '🎵 Canciones añadidas', value: `${songs.length}`, inline: true },
                    { name: '👤 Solicitado por', value: message.author.tag, inline: true }
                )
                .setThumbnail(playlist.thumbnail.url);
            
            await message.channel.send({ embeds: [embed] });
            
            if (!queue.isPlaying) {
                playSong(message.guild, queue);
            }
            
            return;
        }
        // Buscar en YouTube
        else {
            const yt_info = await play.search(query, { limit: 1 });
            
            if (!yt_info.length) {
                await searchMsg.delete();
                return message.reply('❌ No se encontraron resultados.');
            }
            
            const video = yt_info[0];
            song = {
                title: video.title,
                url: video.url,
                duration: formatDuration(video.durationInSec),
                thumbnail: video.thumbnails[0].url,
                requester: message.author.tag
            };
        }

        // Obtener o crear cola
        let queue = queues.get(message.guild.id);
        
        if (!queue) {
            queue = new MusicQueue();
            queue.textChannel = message.channel;
            queues.set(message.guild.id, queue);
            
            // Unirse al canal de voz
            queue.connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: message.guild.id,
                adapterCreator: message.guild.voiceAdapterCreator,
            });

            await entersState(queue.connection, VoiceConnectionStatus.Ready, 30_000);
            queue.connection.subscribe(queue.player);
            
            queue.songs.push(song);
            
            await searchMsg.delete();
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('🎵 Reproduciendo ahora')
                .setDescription(`[${song.title}](${song.url})`)
                .addFields(
                    { name: '⏱️ Duración', value: song.duration, inline: true },
                    { name: '👤 Solicitado por', value: song.requester, inline: true }
                )
                .setThumbnail(song.thumbnail);
            
            await message.channel.send({ embeds: [embed] });
            
            playSong(message.guild, queue);
        } else {
            queue.songs.push(song);
            
            await searchMsg.delete();
            const embed = new EmbedBuilder()
                .setColor('#0099ff')
                .setTitle('➕ Añadido a la cola')
                .setDescription(`[${song.title}](${song.url})`)
                .addFields(
                    { name: '⏱️ Duración', value: song.duration, inline: true },
                    { name: '📝 Posición', value: `#${queue.songs.length}`, inline: true }
                )
                .setThumbnail(song.thumbnail);
            
            await message.channel.send({ embeds: [embed] });
        }
        
    } catch (error) {
        console.error('Error en play_command:', error);
        message.reply('❌ Hubo un error al reproducir la canción. Intenta nuevamente.');
    }
}

// Función para reproducir canciones
async function playSong(guild, queue) {
    if (!queue.songs.length) {
        setTimeout(() => {
            if (queue.connection) {
                queue.connection.destroy();
            }
            queues.delete(guild.id);
        }, 300000); // 5 minutos
        
        if (queue.textChannel) {
            queue.textChannel.send('✅ Cola terminada. Desconectándome en 5 minutos si no se añaden más canciones.');
        }
        return;
    }

    const song = queue.songs[0];
    
    try {
        const stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });

        if (resource.volume) {
            resource.volume.setVolume(queue.volume);
        }

        queue.player.play(resource);
        queue.isPlaying = true;

        queue.player.once(AudioPlayerStatus.Idle, () => {
            queue.songs.shift();
            queue.isPlaying = false;
            playSong(guild, queue);
        });

        queue.player.on('error', error => {
            console.error('Error en el player:', error);
            queue.songs.shift();
            queue.isPlaying = false;
            
            if (queue.textChannel) {
                queue.textChannel.send('❌ Error al reproducir la canción. Saltando...');
            }
            
            playSong(guild, queue);
        });

    } catch (error) {
        console.error('Error en playSong:', error);
        queue.songs.shift();
        queue.isPlaying = false;
        
        if (queue.textChannel) {
            queue.textChannel.send('❌ Error al cargar la canción. Saltando...');
        }
        
        playSong(guild, queue);
    }
}

// Comando SKIP
async function skip_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || !queue.songs.length) {
        return message.reply('❌ No hay canciones en la cola.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    queue.player.stop();
    await message.react('⏭️');
}

// Comando STOP
async function stop_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue) {
        return message.reply('❌ No hay nada reproduciéndose.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    queue.songs = [];
    queue.player.stop();
    
    if (queue.connection) {
        queue.connection.destroy();
    }
    
    queues.delete(message.guild.id);
    
    await message.reply('⏹️ Reproducción detenida y desconectado del canal.');
}

// Comando PAUSE
async function pause_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || !queue.isPlaying) {
        return message.reply('❌ No hay nada reproduciéndose.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    queue.player.pause();
    await message.react('⏸️');
}

// Comando RESUME
async function resume_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue) {
        return message.reply('❌ No hay nada en la cola.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    queue.player.unpause();
    await message.react('▶️');
}

// Comando QUEUE
async function queue_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || !queue.songs.length) {
        return message.reply('❌ La cola está vacía.');
    }

    const queueList = queue.songs.slice(0, 10).map((song, index) => {
        const prefix = index === 0 ? '🎵 **[Reproduciendo]**' : `**${index}.**`;
        return `${prefix} [${song.title}](${song.url}) - \`${song.duration}\` | ${song.requester}`;
    }).join('\n\n');

    const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📜 Cola de Reproducción')
        .setDescription(queueList)
        .setFooter({ text: `Total: ${queue.songs.length} canción${queue.songs.length !== 1 ? 'es' : ''} en cola` });
    
    if (queue.songs.length > 10) {
        embed.addFields({ 
            name: '\u200b', 
            value: `*...y ${queue.songs.length - 10} canción${queue.songs.length - 10 !== 1 ? 'es' : ''} más*` 
        });
    }

    message.channel.send({ embeds: [embed] });
}

// Comando NOW PLAYING
async function nowplaying_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || !queue.songs.length) {
        return message.reply('❌ No hay nada reproduciéndose.');
    }

    const song = queue.songs[0];
    
    const embed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('🎵 Reproduciendo ahora')
        .setDescription(`[${song.title}](${song.url})`)
        .addFields(
            { name: '⏱️ Duración', value: song.duration, inline: true },
            { name: '👤 Solicitado por', value: song.requester, inline: true },
            { name: '📝 En cola', value: `${queue.songs.length - 1} canción${queue.songs.length - 1 !== 1 ? 'es' : ''}`, inline: true }
        )
        .setThumbnail(song.thumbnail)
        .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
}

// Comando CLEAR
async function clear_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || queue.songs.length <= 1) {
        return message.reply('❌ No hay canciones en la cola para limpiar.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    const currentSong = queue.songs[0];
    queue.songs = [currentSong];
    
    await message.reply('🗑️ Cola limpiada. Canción actual sigue reproduciéndose.');
}

// Comando REMOVE
async function remove_command(message, args) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || queue.songs.length <= 1) {
        return message.reply('❌ No hay canciones en la cola para eliminar.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    const position = parseInt(args[0]);
    
    if (!position || position < 1 || position >= queue.songs.length) {
        return message.reply('❌ Posición inválida. Usa `>>queue` para ver las posiciones.');
    }

    const removed = queue.songs.splice(position, 1)[0];
    
    await message.reply(`✅ Eliminada: **${removed.title}**`);
}

// Comando SHUFFLE
async function shuffle_command(message) {
    const queue = queues.get(message.guild.id);
    
    if (!queue || queue.songs.length <= 2) {
        return message.reply('❌ No hay suficientes canciones en la cola para mezclar.');
    }

    if (!message.member.voice.channel) {
        return message.reply('❌ Debes estar en un canal de voz.');
    }

    const currentSong = queue.songs.shift();
    
    for (let i = queue.songs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
    }
    
    queue.songs.unshift(currentSong);
    
    await message.reply('🔀 Cola mezclada aleatoriamente.');
}

// Comando LOOP
async function loop_command(message, args) {
    const queue = queues.get(message.guild.id);
    
    if (!queue) {
        return message.reply('❌ No hay nada reproduciéndose.');
    }

    // Esta funcionalidad requeriría más implementación
    message.reply('⚠️ Función de repetición próximamente.');
}

// Comando HELP
async function help_command(message) {
    const embed = new EmbedBuilder()
        .setColor('#9b59b6')
        .setTitle('🎵 Comandos del Bot de Música')
        .setDescription('Prefix: `>>`')
        .addFields(
            { 
                name: '🎵 Reproducción', 
                value: '`>>play [canción]` - Reproduce música (alias: p)\n' +
                       '`>>pause` - Pausa la reproducción\n' +
                       '`>>resume` - Reanuda (alias: r)\n' +
                       '`>>skip` - Salta canción (alias: s)\n' +
                       '`>>stop` - Detiene y desconecta (alias: dc)',
                inline: false 
            },
            { 
                name: '📋 Cola', 
                value: '`>>queue` - Muestra la cola (alias: q)\n' +
                       '`>>nowplaying` - Canción actual (alias: np)\n' +
                       '`>>clear` - Limpia la cola\n' +
                       '`>>remove [#]` - Elimina canción\n' +
                       '`>>shuffle` - Mezcla la cola',
                inline: false 
            },
            { 
                name: 'ℹ️ Información', 
                value: '`>>help` - Muestra este mensaje (alias: h)',
                inline: false 
            }
        )
        .setFooter({ text: 'Bot de Música v1.0' })
        .setTimestamp();
    
    message.channel.send({ embeds: [embed] });
}

// Función auxiliar para formatear duración
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

// Manejo de errores
process.on('unhandledRejection', error => {
    console.error('Error no manejado:', error);
});

client.on('error', error => {
    console.error('Error del cliente:', error);
});

// Login del bot
client.login(process.env.DISCORD_TOKEN);
