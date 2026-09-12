class ApiConfig {
  // Replace this with your Tailscale IP (e.g., 100.x.x.x) or MagicDNS name
  static const String tailscaleServerIp = '100.64.0.0'; 
  static const int port = 3000;
  
  static String get baseUrl => 'http://$tailscaleServerIp:$port';
}
