using SocketIOClient;

// Console chat client. Usage: dotnet run -- [server-url]   (default http://localhost:3000,
// or the CHAT_SERVER_URL environment variable). Type a message and press Enter;
// "/users" lists who is online, "exit" quits.
class Program
{
    // Each user gets their own colour, in the order they first speak.
    static readonly Dictionary<string, ConsoleColor> UserColors = new();
    static readonly ConsoleColor[] AvailableColors =
    {
        ConsoleColor.Cyan, ConsoleColor.Green, ConsoleColor.Magenta,
        ConsoleColor.Yellow, ConsoleColor.Blue, ConsoleColor.DarkCyan,
        ConsoleColor.DarkYellow, ConsoleColor.DarkMagenta
    };
    static readonly object ConsoleLock = new();

    static async Task<int> Main(string[] args)
    {
        string url = args.Length > 0 ? args[0]
            : Environment.GetEnvironmentVariable("CHAT_SERVER_URL") ?? "http://localhost:3000";

        var socket = new SocketIOClient.SocketIO(url);
        var nameConfirmed = new TaskCompletionSource<string>();

        socket.OnConnected += (_, _) => WriteColored($"✅ Connected to {url}", ConsoleColor.Green);
        socket.OnDisconnected += (_, reason) => WriteColored($"Disconnected ({reason}).", ConsoleColor.DarkGray);

        socket.On("request_name", async _ =>
        {
            Console.Write("Enter your name: ");
            string name = Console.ReadLine()?.Trim() ?? "";
            await socket.EmitAsync("set_name", name);
        });

        socket.On("name_confirmed", response =>
        {
            string name = response.GetValue<NameConfirmed>().name ?? "";
            nameConfirmed.TrySetResult(name);
        });

        socket.On("chat_message", response =>
        {
            try
            {
                var data = response.GetValue<ChatMessage>();
                PrintMessage(data.user ?? "Unknown", data.message ?? "");
            }
            catch (Exception)
            {
                WriteColored("Received a message in an unknown format.", ConsoleColor.DarkGray);
            }
        });

        try
        {
            await socket.ConnectAsync();
        }
        catch (Exception e)
        {
            WriteColored($"Could not connect to {url}: {e.Message}", ConsoleColor.Red);
            return 1;
        }

        string me = await nameConfirmed.Task;
        WriteColored($"You are \"{me}\". Type a message and press Enter. /users = who is online, exit = quit.", ConsoleColor.DarkGray);

        while (true)
        {
            string? input = Console.ReadLine();
            if (input is null || input.Trim().Equals("exit", StringComparison.OrdinalIgnoreCase)) break;
            if (string.IsNullOrWhiteSpace(input)) continue;

            await socket.EmitAsync("chat_message", new Dictionary<string, string> { ["message"] = input });
        }

        await socket.DisconnectAsync();
        return 0;
    }

    static void PrintMessage(string user, string message)
    {
        lock (ConsoleLock)
        {
            if (!UserColors.TryGetValue(user, out var color))
            {
                color = user == "Server" ? ConsoleColor.DarkGray : AvailableColors[UserColors.Count % AvailableColors.Length];
                UserColors[user] = color;
            }

            var original = Console.ForegroundColor;
            Console.ForegroundColor = color;
            Console.Write($"{user}: ");
            Console.ForegroundColor = original;
            Console.WriteLine(message);
        }
    }

    static void WriteColored(string text, ConsoleColor color)
    {
        lock (ConsoleLock)
        {
            var original = Console.ForegroundColor;
            Console.ForegroundColor = color;
            Console.WriteLine(text);
            Console.ForegroundColor = original;
        }
    }

    // Shapes of the JSON the server sends (property names match the server).
    public class ChatMessage
    {
        public string? user { get; set; }
        public string? message { get; set; }
    }

    public class NameConfirmed
    {
        public string? name { get; set; }
    }
}
