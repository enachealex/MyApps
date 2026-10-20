// Progress, kept in PlayerPrefs as JSON. Fields get added as more of the
// game is ported; JsonUtility leaves missing ones at their defaults, so old
// saves keep loading.

using System;
using System.Collections.Generic;
using UnityEngine;

namespace Graveway
{
    [Serializable]
    public sealed class SaveData
    {
        public int coins;
        public int best;                     // furthest run, metres
        public int runs;
        public int kills;
        public string character = "rook";
        public List<string> owned = new List<string> { "pistol" };
        public bool sound = true, haptics = true;
    }

    public static class Save
    {
        const string Key = "graveway.save.v1";
        static SaveData data;

        public static SaveData Data
        {
            get
            {
                if (data != null) return data;
                try
                {
                    var json = PlayerPrefs.GetString(Key, "");
                    data = string.IsNullOrEmpty(json) ? new SaveData() : JsonUtility.FromJson<SaveData>(json);
                }
                catch (Exception e)
                {
                    Debug.LogWarning($"Graveway: save unreadable, starting fresh ({e.Message})");
                    data = new SaveData();
                }
                if (data.owned == null || data.owned.Count == 0) data.owned = new List<string> { "pistol" };
                return data;
            }
        }

        public static void Persist()
        {
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(Data));
            PlayerPrefs.Save();
        }
    }
}
